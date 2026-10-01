import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CameraViewport } from '../../components/CameraViewport';
import { Icon } from '../../components/Icon';
import type { MotionEngine, MotionFrame } from '../../features/engine/MotionEngine';
import { GameEngine, type GameEvent, type PlayerInput } from '../../features/gameplay/GameEngine';
import { isPickup, OBSTACLE_REQUIREMENT } from '../../features/gameplay/types';
import { isErrorVerdict } from '../../features/gestures/ErrorDiagnosisEngine';
import { motionMeta, schemeOf, type Arrow } from '../../features/gestures/types';
import { courseForMode, rulesForMode, type GameModeDef } from '../../features/modes/modes';
import { PLAYER_COLORS } from '../../features/render/DanceRenderer';
import { GameRenderer } from '../../features/render/GameRenderer';
import { computeSessionStats } from '../../features/results/sessionStats';
import type { TwoPlayerTracking } from '../../features/tracking/splitTracking';
import { PlayerTracker } from '../../features/versus/PlayerTracker';
import { useEngineFrame } from '../../hooks/useEngine';
import { RunnerMusic } from '../../lib/audio/runnerMusic';
import { sfx } from '../../lib/audio/sfx';
import { DEBUG } from '../../lib/env';
import './VersusScreen.css';

interface VersusScreenProps {
  engine: MotionEngine;
  mode: GameModeDef;
  onAgain: () => void;
  onModes: () => void;
}

type Stage = 'setup' | 'play' | 'done';

/** A miss reason stays on screen this long. */
const MISS_MS = 2200;
/** After the race a jump counts as "rematch" only after this pause. */
const REMATCH_ARM_MS = 1500;
const GO_MS = 700;

interface SideHud {
  status: string;
  progress: number;
  ready: boolean;
  visible: boolean;
  score: number;
  energy: number;
  combo: number;
  cueTitle: string | null;
  cueArrow: Arrow | null;
  /** Error-mode hint for the coming obstacle. */
  hint: string | null;
  miss: string | null;
  ended: boolean;
}

interface Hud {
  sides: SideHud[];
  countdown: number | 'go' | null;
  tracking: TwoPlayerTracking;
}

function sound(event: GameEvent, primary: boolean): void {
  switch (event.type) {
    case 'countdown':
      // Both games count down together — one tick is enough.
      if (primary) sfx.play(event.value === 0 ? 'go' : 'tick');
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
    case 'jump':
      sfx.play('jump');
      break;
    default:
      break;
  }
}

/**
 * Local two-player runner: both players share one camera — P1 plays in the left
 * half of the picture, P2 in the right half — and race the same course on split
 * screens. Each player has a tracker of their own (split tracking in the worker)
 * and an independent recognition pipeline, error-mode hints included.
 */
export function VersusScreen({ engine, mode, onAgain, onModes }: VersusScreenProps) {
  const [games] = useState(() => {
    const course = courseForMode(mode);
    return [0, 1].map(() => new GameEngine(course, undefined, rulesForMode(mode, 'body')));
  });
  const trackers = useRef<PlayerTracker[] | null>(null);
  const canvases = useRef<(HTMLCanvasElement | null)[]>([null, null]);
  const backgrounds = useRef<(HTMLCanvasElement | null)[]>([null, null]);
  const renderers = useRef<GameRenderer[]>([]);
  const misses = useRef<({ message: string; at: number } | null)[]>([null, null]);
  const stageRef = useRef<Stage>('setup');
  const [stage, setStage] = useState<Stage>('setup');
  const goAt = useRef<number | null>(null);
  const finishedAt = useRef(0);
  const rematched = useRef(false);
  const [hud, setHud] = useState<Hud>({ sides: [], countdown: null, tracking: 'loading' });
  const [music] = useState(() => new RunnerMusic());
  useEffect(() => () => music.stop(), [music]);
  const hudKey = useRef('');

  useEffect(() => {
    engine.setExpected(null);
    engine.setPlayers(2);
    const list: GameRenderer[] = [];
    for (let i = 0; i < 2; i++) {
      const c = canvases.current[i];
      const b = backgrounds.current[i];
      if (c && b) list.push(new GameRenderer(c, b));
    }
    renderers.current = list;
    return () => {
      engine.setPlayers(1);
      for (const r of list) r.dispose();
      renderers.current = [];
    };
  }, [engine]);

  useEngineFrame(engine, (frame, dt) => {
    if (frame.videoWidth === 0) return;
    const half = frame.aspect / 2;
    trackers.current ??= [new PlayerTracker({ x0: 0, x1: half }), new PlayerTracker({ x0: half, x1: frame.aspect })];
    const ts = trackers.current;
    const now = frame.time;
    // ?debug=1: inspect both players' pipelines from the console.
    if (DEBUG) (window as unknown as { __versus?: unknown }).__versus = { trackers: ts, games, frame };
    if (frame.inferred) ts.forEach((t, i) => t.update(frame.players[i] ?? null, now));
    if (stageRef.current === 'setup' && ts.every((t) => t.baseline)) {
      stageRef.current = 'play';
      setStage('play');
    }
    const playing = stageRef.current !== 'setup';

    const sides: SideHud[] = ts.map((t, i) => {
      const game = games[i] as GameEngine;
      const renderer = renderers.current[i];
      t.setExpected(game.expected);
      if (playing) {
        const input = t.input();
        // Both countdowns run together, so nobody gets a head start.
        const synced: PlayerInput = game.phase === 'countdown' ? { ...input, trackable: true } : input;
        for (const event of game.update(dt, synced)) {
          renderer?.handleEvent(event, now);
          sound(event, i === 0);
          if (event.type === 'miss') misses.current[i] = { message: event.reason.message, at: now };
          if (event.type === 'countdown' && event.value === 0 && i === 0) {
            goAt.current = now;
            music.start();
          }
        }
      }
      if (renderer) {
        const view = { ...frame, pose: t.pose, displayPose: t.pose, baseline: t.baseline, trackable: t.trackable, features: t.features } as MotionFrame;
        renderer.render(game, view, dt, now);
      }
      const next = game.nextRequired;
      const meta = next && !isPickup(next.kind) && game.phase === 'running' ? motionMeta(OBSTACLE_REQUIREMENT[next.kind], schemeOf(t.baseline?.mode)) : null;
      const hint = t.hint && isErrorVerdict(t.hint.verdict) ? t.hint.message : null;
      const miss = misses.current[i];
      return {
        status: t.setupStatus,
        progress: t.baseline ? 100 : Math.round(t.calibration.progress * 100),
        ready: t.baseline !== null,
        visible: t.trackable,
        score: game.score,
        energy: game.energy,
        combo: game.combo,
        cueTitle: meta?.title ?? null,
        cueArrow: meta?.arrow ?? null,
        hint,
        miss: miss && now - miss.at < MISS_MS ? miss.message : null,
        ended: game.phase === 'ended',
      };
    });

    const lead = games[0] as GameEngine;
    const countdown: Hud['countdown'] =
      playing && lead.phase === 'countdown' ? lead.countdownValue : goAt.current !== null && now - goAt.current < GO_MS ? 'go' : null;

    if (music.playing) {
      const stage = Math.floor(lead.time / 18000);
      music.update(Math.min(3, stage));
    }
    if (stageRef.current === 'play' && games.every((g) => g.phase === 'ended')) {
      music.stop();
      stageRef.current = 'done';
      finishedAt.current = now;
      setStage('done');
    }
    if (stageRef.current === 'done') {
      // "Jump to play again" — either player can start the rematch.
      if (now - finishedAt.current < REMATCH_ARM_MS) ts.forEach((t) => (t.jumped = false));
      else if (!rematched.current && ts.some((t) => t.jumped)) {
        rematched.current = true;
        sfx.play('confirm');
        onAgain();
      }
    }

    const next: Hud = { sides, countdown, tracking: frame.twoPlayer };
    const key = JSON.stringify(next);
    if (key !== hudKey.current) {
      hudKey.current = key;
      setHud(next);
    }
  });

  const [a, b] = games;
  const winner = stage === 'done' && a && b ? (a.score === b.score ? 0 : a.score > b.score ? 1 : 2) : null;

  return (
    <main className="screen versus">
      <div className="versus__stages">
        {[0, 1].map((i) => {
          const s = hud.sides[i];
          return (
            <section key={i} className="versus__stage" style={{ '--pc': PLAYER_COLORS[i] } as CSSProperties} aria-label={`Игрок ${i + 1}`}>
              <canvas ref={(el) => void (backgrounds.current[i] = el)} className="game__canvas" aria-hidden="true" />
              <canvas ref={(el) => void (canvases.current[i] = el)} className="game__canvas" aria-hidden="true" />
              <div className="versus__hud">
                <div className="versus__top">
                  <span className="versus__tag">Игрок {i + 1}</span>
                  <strong className="versus__score">{(s?.score ?? 0).toLocaleString('ru-RU')}</strong>
                  <div className="hud__energy" role="img" aria-label={`Жизни: ${s?.energy ?? mode.energy}`}>
                    {Array.from({ length: mode.energy }, (_, k) => (
                      <span key={k} className={`hud__cell ${k < (s?.energy ?? mode.energy) ? 'is-full' : ''}`} />
                    ))}
                  </div>
                </div>
                {s && s.combo >= 3 && <span className="versus__combo">комбо {s.combo}</span>}
                {s?.miss && <p className="versus__miss">{s.miss}</p>}
                {stage === 'play' && s && !s.visible && !s.ended && <p className="versus__lost">Вернись в свою половину кадра</p>}
                {s?.ended && stage === 'play' && <p className="versus__done">Финиш! Ждём соперника</p>}
                <div className="versus__bottom">
                  {s?.cueTitle && (
                    <div className="versus__cue">
                      {s.cueArrow && <Icon name={s.cueArrow} size={26} />}
                      <strong>{s.cueTitle}</strong>
                    </div>
                  )}
                  {s?.hint && <p className="versus__hint">{s.hint}</p>}
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {stage !== 'setup' && (
        <div className="versus__pip" aria-label="Камера: игрок 1 слева, игрок 2 справа">
          <CameraViewport engine={engine} variant="pip" hud={false} trail={false} />
        </div>
      )}

      <AnimatePresence>
        {hud.countdown !== null && (
          <motion.span
            key={hud.countdown}
            className="countdown versus__countdown"
            initial={{ scale: 2, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            {hud.countdown === 'go' || hud.countdown === 0 ? 'Старт!' : hud.countdown}
          </motion.span>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {stage === 'setup' && (
          <motion.div key="setup" className="overlay versus__setup" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <p className="t-label">{mode.title} · игра вдвоём</p>
            <h2 className="t-headline">Встаньте рядом: игрок 1 слева, игрок 2 справа</h2>
            <div className="versus__cam">
              <CameraViewport engine={engine} variant="panel" hud={false} className="versus__camera" />
              <span className="versus__cam-label versus__cam-label--p1">Игрок 1</span>
              <span className="versus__cam-label versus__cam-label--p2">Игрок 2</span>
            </div>
            {hud.tracking === 'loading' ? (
              <p className="versus__loading">Включаем распознавание для двоих…</p>
            ) : (
              <div className="versus__players">
                {[0, 1].map((i) => {
                  const s = hud.sides[i];
                  return (
                    <div key={i} className={`versus__player ${s?.ready ? 'is-ready' : ''}`} style={{ '--pc': PLAYER_COLORS[i] } as CSSProperties}>
                      <span className="versus__player-name">Игрок {i + 1}</span>
                      <span className="versus__player-status">{s?.status ?? 'Не вижу — встань в свою половину'}</span>
                      <span className="versus__bar" aria-hidden="true">
                        <span style={{ width: `${s?.progress ?? 0}%` }} />
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="overlay__message">
              Отойдите на 2–3 шага, чтобы камера видела вас целиком, и постойте ровно секунду. Каждый управляет своим бегуном: перебегай
              между полосами в своей половине, прыгай и приседай.
            </p>
          </motion.div>
        )}
        {stage === 'done' && (
          <motion.div key="end" className="overlay versus__end" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <p className="t-label">{mode.title} · итог</p>
            <h2 className="t-display versus__winner">{winner === 0 ? 'Ничья!' : `Победил игрок ${winner}`}</h2>
            <div className="versus__results">
              {games.map((g, i) => {
                const stats = computeSessionStats(g.result());
                return (
                  <div key={i} className={`dance__card ${winner === i + 1 ? 'is-winner' : ''}`} style={{ '--pc': PLAYER_COLORS[i] } as CSSProperties}>
                    <span className="t-label">Игрок {i + 1}</span>
                    <strong className="dance__card-score">{g.score.toLocaleString('ru-RU')}</strong>
                    <span>
                      Точность {Math.round(stats.accuracy * 100)}% · лучшее комбо {g.bestCombo}
                    </span>
                    {stats.needsWork && <span className="dance__weak">Потренировать: {motionMeta(stats.needsWork.motion, 'body').title}</span>}
                  </div>
                );
              })}
            </div>
            <p className="versus__rematch">Подпрыгните, чтобы сыграть ещё раз</p>
            <div className="dance__actions">
              <button type="button" className="btn btn--primary" onClick={onAgain}>
                Реванш
              </button>
              <button type="button" className="btn btn--ghost" onClick={onModes}>
                <Icon name="left" size={16} /> Режимы
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
