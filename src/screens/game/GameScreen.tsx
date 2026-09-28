import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { CameraViewport } from '../../components/CameraViewport';
import { HintPanel } from '../../components/HintPanel';
import { Icon } from '../../components/Icon';
import { Ring } from '../../components/Ring';
import { setRingProgress } from '../../components/ringProgress';
import { GAME_CONFIG } from '../../config/game.config';
import type { MotionEngine, MotionFrame } from '../../features/engine/MotionEngine';
import type { Diagnosis } from '../../features/gestures/ErrorDiagnosisEngine';
import { MOTION_META } from '../../features/gestures/types';
import { generateCourse } from '../../features/gameplay/course';
import { GameEngine, type GameEvent, type PlayerInput } from '../../features/gameplay/GameEngine';
import { OBSTACLE_REQUIREMENT, type GameOutcome, type Lane, type SessionResult } from '../../features/gameplay/types';
import { GameRenderer } from '../../features/render/GameRenderer';
import { useEngineFrame, useMotionUi } from '../../hooks/useEngine';
import { sfx } from '../../lib/audio/sfx';
import { clamp } from '../../lib/math/geometry';
import { RollingNumber } from './RollingNumber';
import './GameScreen.css';

const PHASE_NAMES = ['Warm-up', 'Flow', 'Rush', 'Challenge'];
const END_REVEAL_MS = 1600;

interface HudState {
  score: number;
  combo: number;
  multiplier: number;
  energy: number;
  phase: GameEngine['phase'];
  countdown: number | null;
  nextId: number | null;
  stage: number;
  outcome: GameOutcome | null;
}

function snapshot(game: GameEngine, outcome: GameOutcome | null): HudState {
  const next = game.nextRequired;
  const stage = GAME_CONFIG.course.phases.findIndex((p) => game.time < p.untilMs);
  return {
    score: game.score,
    combo: game.combo,
    multiplier: game.multiplier,
    energy: game.energy,
    phase: game.phase,
    countdown: game.countdownValue,
    nextId: next?.id ?? null,
    stage: stage < 0 ? PHASE_NAMES.length - 1 : stage,
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

interface GameScreenProps {
  engine: MotionEngine;
  onFinish: (result: SessionResult) => void;
}

/** One run of the game. The parent re-mounts it (via `key`) for every new run. */
export function GameScreen({ engine, onFinish }: GameScreenProps) {
  const [game] = useState(() => new GameEngine(generateCourse()));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GameRenderer | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const resumeRef = useRef<SVGCircleElement>(null);
  const outcomeRef = useRef<GameOutcome | null>(null);
  const [hud, setHud] = useState<HudState>(() => snapshot(game, null));
  const hudRef = useRef(hud);
  const reduced = useReducedMotion() ?? false;
  const multiple = useMotionUi(engine, (s) => s.multiplePeople);
  const trackingMessage = useMotionUi(engine, (s) => s.trackingMessage);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new GameRenderer(canvas);
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
      if (event.type === 'end') outcomeRef.current = event.outcome;
    }
    renderer?.render(game, frame, dt, frame.time);
    if (progressRef.current) progressRef.current.style.transform = `scaleX(${clamp(game.time / game.duration, 0, 1)})`;
    setRingProgress(resumeRef.current, game.resumeProgress);

    const next = snapshot(game, outcomeRef.current);
    if (!sameHud(next, hudRef.current)) {
      hudRef.current = next;
      setHud(next);
    }
  });

  const nextItem = game.nextRequired;
  const nextMotion = nextItem && nextItem.kind !== 'ORB' ? OBSTACLE_REQUIREMENT[nextItem.kind] : null;
  const playing = hud.phase === 'running';

  return (
    <main className="screen game">
      <section className="game__stage" aria-label="Игровое поле">
        <canvas ref={canvasRef} className="game__canvas" aria-hidden="true" />

        <div className="hud">
          <div className="hud__top">
            <div className="hud__score">
              <span className="t-label">Score</span>
              <RollingNumber value={hud.score} className="hud__score-value" />
              {hud.multiplier > 1 && <span className="hud__multi">×{hud.multiplier}</span>}
            </div>
            <div className="hud__progress">
              <div className="hud__progress-track">
                <div ref={progressRef} className="hud__progress-fill" />
              </div>
              <span className="t-label">{PHASE_NAMES[hud.stage]}</span>
            </div>
            <div className="hud__energy" role="img" aria-label={`Энергия: ${hud.energy} из ${GAME_CONFIG.energy}`}>
              {Array.from({ length: GAME_CONFIG.energy }, (_, i) => (
                <span key={i} className={`hud__cell ${i < hud.energy ? 'is-full' : ''}`} />
              ))}
            </div>
          </div>

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
                <span className="t-label">combo</span>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="hud__bottom">
            {nextMotion && playing && (
              <div className="hud__cue" key={hud.nextId}>
                <span className="t-label">Next</span>
                {MOTION_META[nextMotion].arrow && <Icon name={MOTION_META[nextMotion].arrow} size={18} />}
                <strong>{MOTION_META[nextMotion].title}</strong>
                <span className="hud__cue-text">{MOTION_META[nextMotion].cue}</span>
              </div>
            )}
            <HintPanel engine={engine} variant="compact" />
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
                    {hud.countdown === 0 ? 'GO' : hud.countdown}
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
              <p className="t-label">{hud.phase === 'resuming' ? 'Resuming' : 'Tracking lost'}</p>
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
                {hud.outcome === 'complete' ? 'Motion complete' : 'Out of energy'}
              </motion.h2>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <aside className="game__side">
        <CameraViewport engine={engine} variant="panel" guidance={playing} />
        {multiple && (
          <div className="game__warning" role="status">
            <Icon name="users" size={16} /> ONE PLAYER ONLY — оставь в кадре одного человека
          </div>
        )}
      </aside>
    </main>
  );
}
