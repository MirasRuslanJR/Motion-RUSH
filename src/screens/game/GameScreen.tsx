import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { CameraViewport } from '../../components/CameraViewport';
import { HintPanel } from '../../components/HintPanel';
import { Icon } from '../../components/Icon';
import { Ring } from '../../components/Ring';
import { setRingProgress } from '../../components/ringProgress';
import { COURSES } from '../../config/game.config';
import type { MotionEngine, MotionFrame } from '../../features/engine/MotionEngine';
import type { Diagnosis } from '../../features/gestures/ErrorDiagnosisEngine';
import { motionMeta, type ControlScheme, type ExpectedMotion, type GestureType } from '../../features/gestures/types';
import { GameEngine, type GameEvent, type PlayerInput } from '../../features/gameplay/GameEngine';
import { isPickup, OBSTACLE_REQUIREMENT, type CourseItem, type GameOutcome, type Lane, type SessionResult } from '../../features/gameplay/types';
import { courseForMode, rulesForMode, type GameModeDef } from '../../features/modes/modes';
import { computeSessionStats } from '../../features/results/sessionStats';
import type { DuelRoom } from '../../features/online/DuelRoom';
import { GameRenderer } from '../../features/render/GameRenderer';
import { useEngineFrame, useMotionUi } from '../../hooks/useEngine';
import { RunnerMusic } from '../../lib/audio/runnerMusic';
import { sfx } from '../../lib/audio/sfx';
import { clamp } from '../../lib/math/geometry';
import { useStore } from '../../lib/store';
import { RollingNumber } from './RollingNumber';
import './GameScreen.css';

const PHASE_NAMES = ['Разминка', 'Разгон', 'Скорость', 'Финиш', 'Шквал', 'Овердрайв', 'Безумие'];
const END_REVEAL_MS = 1600;
const MISS_TOAST_MS = 2200;
/** Live state is broadcast to the duel opponent at ~5 Hz. */
const DUEL_SEND_MS = 200;

interface HudState {
  score: number;
  combo: number;
  multiplier: number;
  energy: number;
  shield: boolean;
  boosted: boolean;
  phase: GameEngine['phase'];
  countdown: number | null;
  nextId: number | null;
  stage: number;
  outcome: GameOutcome | null;
}

function stageOf(game: GameEngine, mode: GameModeDef): number {
  const phases = COURSES[mode.course].phases;
  const stage = phases.findIndex((p) => game.time < p.untilMs);
  return stage < 0 ? phases.length - 1 : stage;
}

/** Progress bar: share of the course; in Endless — progress through the current speed stage. */
function progressOf(game: GameEngine, mode: GameModeDef, stage: number): number {
  if (mode.course !== 'endless') return clamp(game.time / game.duration, 0, 1);
  const phases = COURSES.endless.phases;
  const from = stage > 0 ? (phases[stage - 1]?.untilMs ?? 0) : 0;
  const to = phases[stage]?.untilMs ?? game.duration;
  return clamp((game.time - from) / (to - from), 0, 1);
}

function snapshot(game: GameEngine, mode: GameModeDef, outcome: GameOutcome | null): HudState {
  const next = game.nextRequired;
  return {
    score: game.score,
    combo: game.combo,
    multiplier: game.multiplier,
    energy: game.energy,
    shield: game.shield,
    boosted: game.boosted,
    phase: game.phase,
    countdown: game.countdownValue,
    nextId: next?.id ?? null,
    stage: stageOf(game, mode),
    outcome,
  };
}

function sameHud(a: HudState, b: HudState): boolean {
  return (Object.keys(a) as (keyof HudState)[]).every((k) => a[k] === b[k]);
}

function toInput(d: Diagnosis | null) {
  return d ? { expected: d.expected, verdict: d.verdict, ruleId: d.ruleId, message: d.message } : null;
}

function buildInput(frame: Readonly<MotionFrame>, hint: Diagnosis | null): PlayerInput {
  const lateral = frame.lateral.phase === 'CONFIRMED' ? frame.lateral.gesture : null;
  const vertical = frame.vertical.phase === 'CONFIRMED' ? frame.vertical.gesture : null;
  const lane: Lane = lateral === 'LEAN_LEFT' ? -1 : lateral === 'LEAN_RIGHT' ? 1 : 0;
  return {
    trackable: frame.trackable,
    lane,
    jumpHeld: vertical === 'JUMP',
    crouchHeld: vertical === 'CROUCH',
    diagnosis: toInput(frame.diagnosis),
    hint: toInput(hint),
  };
}

function soundFor(event: GameEvent): void {
  switch (event.type) {
    case 'countdown':
      sfx.play(event.value === 0 ? 'go' : 'tick');
      break;
    case 'clear':
      sfx.play(event.quality === 'perfect' ? 'perfect' : 'clear');
      break;
    case 'miss':
      sfx.play('miss');
      break;
    case 'orb':
      sfx.play('orb');
      break;
    case 'powerup':
      sfx.play('powerup');
      break;
    case 'shield-used':
      sfx.play('shield');
      break;
    case 'combo':
      sfx.play('combo');
      break;
    case 'jump':
      sfx.play('jump');
      break;
    case 'end':
      sfx.play(event.outcome === 'complete' ? 'complete' : 'gameover');
      break;
    default:
      break;
  }
}

const LEGEND: GestureType[] = ['LEAN_LEFT', 'LEAN_RIGHT', 'JUMP', 'CROUCH'];

/** Controls reminder: lights up the move the camera recognises right now. */
function MoveLegend({ engine, next, scheme }: { engine: MotionEngine; next: ExpectedMotion | null; scheme: ControlScheme }) {
  const lateral = useMotionUi(engine, (s) => s.lateral);
  const vertical = useMotionUi(engine, (s) => s.vertical);
  return (
    <ul className="legend" aria-label="Управление">
      {LEGEND.map((g) => {
        const meta = motionMeta(g, scheme);
        const active = g === lateral || g === vertical;
        return (
          <li key={g} className={`${active ? 'is-active' : ''} ${g === next ? 'is-next' : ''}`}>
            {meta.arrow && <Icon name={meta.arrow} size={16} />}
            <span className="legend__name">{meta.title}</span>
            <span className="legend__action">{meta.action}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** The current obstacle and the next few after it, in course order. */
function upcoming(game: GameEngine, fromId: number | null, count: number): CourseItem[] {
  const out: CourseItem[] = [];
  if (fromId === null) return out;
  let found = false;
  for (const item of game.course) {
    if (item.id === fromId) found = true;
    if (!found || isPickup(item.kind)) continue;
    out.push(item);
    if (out.length >= count) break;
  }
  return out;
}

/** What is coming on the course, so the player can get ready for the next move. */
function UpcomingQueue({ items, scheme }: { items: CourseItem[]; scheme: ControlScheme }) {
  if (items.length === 0) return null;
  return (
    <section className="queue" aria-label="Дальше по трассе">
      <span className="t-label">Дальше по трассе</span>
      <ol className="queue__list">
        <AnimatePresence initial={false} mode="popLayout">
          {items.map((item, i) => {
            const kind = item.kind;
            if (isPickup(kind)) return null;
            const meta = motionMeta(OBSTACLE_REQUIREMENT[kind], scheme);
            return (
              <motion.li
                key={item.id}
                layout
                className={i === 0 ? 'is-now' : undefined}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1 - i * 0.2, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.25 }}
              >
                <span className="queue__icon">{meta.arrow ? <Icon name={meta.arrow} size={16} /> : <span className="queue__dot" />}</span>
                <span className="queue__name">{meta.title}</span>
                {i === 0 && <span className="queue__tag">сейчас</span>}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
    </section>
  );
}

/** Duel: the opponent's live score and progress next to yours. */
function OpponentPanel({ room, score }: { room: DuelRoom; score: number }) {
  const opponent = useStore(room.ui, (s) => s.opponent);
  const players = useStore(room.ui, (s) => s.players);
  const left = !players.some((p) => p.id !== room.me.id);
  const theirs = opponent?.score ?? 0;
  const lead = score - theirs;
  return (
    <div className="duel-panel" role="status" aria-live="off">
      <span className="t-label">vs {room.opponentName}</span>
      <strong className="duel-panel__score">{theirs.toLocaleString('ru-RU')}</strong>
      <div className="duel-panel__track">
        <div className="duel-panel__fill" style={{ transform: `scaleX(${opponent?.progress ?? 0})` }} />
      </div>
      <span className={`duel-panel__lead ${lead >= 0 ? 'is-ahead' : 'is-behind'}`}>
        {left ? 'соперник вышел' : opponent?.finished ? 'финишировал' : lead >= 0 ? `ты впереди на ${lead}` : `отстаёшь на ${-lead}`}
      </span>
    </div>
  );
}

interface GameScreenProps {
  engine: MotionEngine;
  mode: GameModeDef;
  /** Course seed from the online room (duel). */
  sharedSeed?: number | null;
  duel?: DuelRoom | null;
  onFinish: (result: SessionResult) => void;
}

/** One run of the game. The parent re-mounts it (via `key`) for every new run. */
export function GameScreen({ engine, mode, sharedSeed = null, duel = null, onFinish }: GameScreenProps) {
  const [scheme] = useState<ControlScheme>(() => engine.ui.get().scheme);
  const [game] = useState(() => new GameEngine(courseForMode(mode, sharedSeed ?? undefined), undefined, rulesForMode(mode, scheme)));
  const lastSentRef = useRef(Number.NEGATIVE_INFINITY);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const backgroundRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GameRenderer | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const resumeRef = useRef<SVGCircleElement>(null);
  const outcomeRef = useRef<GameOutcome | null>(null);
  const [hud, setHud] = useState<HudState>(() => snapshot(game, mode, null));
  const hudRef = useRef(hud);
  /** Why the last obstacle was missed — shown briefly so every miss is explained. */
  const [missToast, setMissToast] = useState<{ id: number; message: string } | null>(null);
  const reduced = useReducedMotion() ?? false;
  const multiple = useMotionUi(engine, (s) => s.multiplePeople);
  const trackingMessage = useMotionUi(engine, (s) => s.trackingMessage);

  useEffect(() => {
    const canvas = canvasRef.current;
    const background = backgroundRef.current;
    if (!canvas || !background) return;
    const renderer = new GameRenderer(canvas, background);
    rendererRef.current = renderer;
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.setReducedMotion(reduced);
  }, [reduced]);

  // Pause when the tab is hidden; keep the screen awake while playing.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) game.pause();
    };
    document.addEventListener('visibilitychange', onVisibility);
    let lock: WakeLockSentinel | null = null;
    navigator.wakeLock
      ?.request('screen')
      .then((l) => {
        lock = l;
      })
      .catch(() => undefined);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      void lock?.release().catch(() => undefined);
    };
  }, [game]);

  useEffect(() => () => engine.setExpected(null), [engine]);

  // Background music: starts on «Старт!», quieter during a pause, stops at the finish.
  const [music] = useState(() => new RunnerMusic());
  useEffect(() => () => music.stop(), [music]);

  useEffect(() => {
    if (!missToast) return;
    const timer = window.setTimeout(() => setMissToast(null), MISS_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [missToast]);

  useEffect(() => {
    if (!hud.outcome) return;
    const timer = window.setTimeout(() => onFinish(game.result()), END_REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [hud.outcome, game, onFinish]);

  useEngineFrame(engine, (frame, dt) => {
    const events = game.update(dt, buildInput(frame, engine.ui.get().hint));
    engine.setExpected(game.expected);
    const renderer = rendererRef.current;
    for (const event of events) {
      renderer?.handleEvent(event, frame.time);
      soundFor(event);
      if (event.type === 'countdown' && event.value === 0) music.start();
      else if (event.type === 'pause') music.duck(true);
      else if (event.type === 'resume') music.duck(false);
      else if (event.type === 'end') music.stop();
      if (event.type === 'end') outcomeRef.current = event.outcome;
      if (event.type === 'miss') setMissToast({ id: event.item.id, message: event.reason.message });
    }
    const next = snapshot(game, mode, outcomeRef.current);
    music.update(Math.min(3, next.stage));
    if (duel) {
      const opp = duel.ui.get().opponent;
      renderer?.setOpponent(opp && !opp.finished ? { name: duel.opponentName, lane: opp.lane, airborne: opp.airborne, ducking: opp.ducking } : null);
      const finished = outcomeRef.current !== null;
      if (lastSentRef.current !== Number.POSITIVE_INFINITY && (finished || frame.time - lastSentRef.current >= DUEL_SEND_MS)) {
        // After the final state nothing more is sent from here (the results screen re-sends it).
        lastSentRef.current = finished ? Number.POSITIVE_INFINITY : frame.time;
        const r = finished ? computeSessionStats(game.result()) : null;
        duel.sendState({
          score: game.score,
          combo: game.combo,
          energy: game.energy,
          progress: clamp(game.time / game.duration, 0, 1),
          lane: game.lane,
          airborne: game.airborne,
          ducking: game.ducking,
          finished,
          outcome: outcomeRef.current,
          accuracy: r ? r.accuracy : null,
        });
      }
    }
    renderer?.render(game, frame, dt, frame.time);
    if (progressRef.current) progressRef.current.style.transform = `scaleX(${progressOf(game, mode, next.stage)})`;
    setRingProgress(resumeRef.current, game.resumeProgress);

    if (!sameHud(next, hudRef.current)) {
      hudRef.current = next;
      setHud(next);
    }
  });

  const nextItem = game.nextRequired;
  const nextMotion = nextItem && !isPickup(nextItem.kind) ? OBSTACLE_REQUIREMENT[nextItem.kind] : null;
  const nextMeta = nextMotion ? motionMeta(nextMotion, scheme) : null;
  const playing = hud.phase === 'running';
  const phases = COURSES[mode.course].phases;
  const stageLabel = phases.length === 1 ? mode.goal : (PHASE_NAMES[hud.stage] ?? `Stage ${hud.stage + 1}`);

  return (
    <main className="screen game">
      <section className="game__stage" aria-label="Игровое поле">
        <canvas ref={backgroundRef} className="game__canvas" aria-hidden="true" />
        <canvas ref={canvasRef} className="game__canvas" aria-hidden="true" />

        <div className="hud">
          <div className="hud__top">
            <div className="hud__score">
              <span className="t-label">{mode.title}</span>
              <RollingNumber value={hud.score} className="hud__score-value" />
              {hud.multiplier > 1 && <span className={`hud__multi ${hud.boosted ? 'is-boost' : ''}`}>×{hud.multiplier}</span>}
            </div>
            <div className="hud__progress">
              <div className="hud__progress-track">
                <div ref={progressRef} className="hud__progress-fill" />
              </div>
              <span className="t-label">{stageLabel}</span>
            </div>
            <div className="hud__right">
              {mode.practice ? (
                <span className="t-label hud__practice">Без штрафов</span>
              ) : (
                <div className="hud__energy" role="img" aria-label={`Энергия: ${hud.energy} из ${mode.energy}`}>
                  {Array.from({ length: mode.energy }, (_, i) => (
                    <span key={i} className={`hud__cell ${i < hud.energy ? 'is-full' : ''}`} />
                  ))}
                </div>
              )}
              <div className="hud__powers">
                {hud.shield && <span className="hud__power hud__power--shield">ЩИТ</span>}
                {hud.boosted && <span className="hud__power hud__power--boost">ОЧКИ ×2</span>}
              </div>
            </div>
          </div>
          {duel && <OpponentPanel room={duel} score={hud.score} />}

          <AnimatePresence>
            {missToast && playing && (
              <motion.div
                key={missToast.id}
                className="hud__miss"
                role="status"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <span className="t-label">Промах</span>
                {missToast.message}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {hud.combo >= 3 && playing && (
              <motion.div
                key={hud.combo}
                className="hud__combo"
                initial={{ scale: 1.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', stiffness: 420, damping: 18 }}
              >
                <span className="t-hud">{hud.combo}</span>
                <span className="t-label">комбо</span>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="hud__bottom">
            {/* One card: the coming move (big) + error-mode advice + progress meter. */}
            <HintPanel engine={engine} variant="compact" headline={nextMeta && playing ? { title: nextMeta.title, arrow: nextMeta.arrow } : null} />
          </div>
        </div>

        <AnimatePresence>
          {hud.phase === 'countdown' && (
            <motion.div className="overlay overlay--countdown" exit={{ opacity: 0 }} key="countdown">
              <AnimatePresence mode="popLayout">
                {hud.countdown === null ? (
                  <motion.p key="wait" className="overlay__message" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    {trackingMessage}
                  </motion.p>
                ) : (
                  <motion.span
                    key={hud.countdown}
                    className="countdown"
                    initial={{ scale: 2.2, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.6, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  >
                    {hud.countdown === 0 ? 'Старт!' : hud.countdown}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.div>
          )}
          {(hud.phase === 'paused' || hud.phase === 'resuming') && (
            <motion.div
              key="paused"
              className="overlay overlay--paused"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              role="alert"
            >
              <p className="t-label">{hud.phase === 'resuming' ? 'Продолжаем' : 'Пауза'}</p>
              <h2 className="t-headline">{hud.phase === 'resuming' ? 'Продолжаем!' : 'Вернись в центр кадра'}</h2>
              <p className="overlay__message">{hud.phase === 'resuming' ? 'Игра продолжится через секунду' : trackingMessage}</p>
              <Ring circleRef={resumeRef} size={72} tone="success">
                <Icon name="person" size={24} />
              </Ring>
            </motion.div>
          )}
          {hud.outcome && (
            <motion.div
              key="ended"
              className="overlay overlay--ended"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4 }}
            >
              <motion.h2
                className="t-display overlay__end-title"
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 200, damping: 16, delay: 0.1 }}
              >
                {hud.outcome === 'complete' ? 'Трасса пройдена!' : mode.energy === 1 ? 'Игра окончена' : 'Энергия закончилась'}
              </motion.h2>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <aside className="game__side">
        <CameraViewport engine={engine} variant="panel" guidance={playing} className="game__camera" />
        {multiple && (
          <div className="game__warning" role="status">
            <Icon name="users" size={16} /> В кадре должен быть один человек
          </div>
        )}
        <MoveLegend engine={engine} next={playing ? nextMotion : null} scheme={scheme} />
        <UpcomingQueue items={playing ? upcoming(game, hud.nextId, 4) : []} scheme={scheme} />
      </aside>
    </main>
  );
}
