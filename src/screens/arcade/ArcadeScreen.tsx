import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CameraViewport } from '../../components/CameraViewport';
import { HoldGesture } from '../../components/HoldGesture';
import { Icon } from '../../components/Icon';
import { ModeIcon } from '../../components/ModeIcon';
import { PoseGlyph } from '../../components/PoseGlyph';
import type { SessionFacts } from '../../features/achievements/achievements';
import { BossFight } from '../../features/arcade/boss';
import { FreezeGame } from '../../features/arcade/freeze';
import { ReactionGame } from '../../features/arcade/reaction';
import { SquatGame } from '../../features/arcade/squats';
import { StarCatch } from '../../features/arcade/starCatch';
import type { ArcadeGame, ArcadeHud, ArcadeResult, ArcadeTune } from '../../features/arcade/types';
import type { MotionEngine } from '../../features/engine/MotionEngine';
import { isErrorVerdict } from '../../features/gestures/ErrorDiagnosisEngine';
import { motionMeta, type ControlScheme, type GestureEvent } from '../../features/gestures/types';
import { arcadeTune, type Difficulty } from '../../features/modes/difficulty';
import { effectiveDifficulty, supportsDifficulty, type ArcadeKind, type GameModeDef } from '../../features/modes/modes';
import { ArcadeRenderer } from '../../features/render/ArcadeRenderer';
import { useEngineFrame, useGestureEvents } from '../../hooks/useEngine';
import { comboLayers, RunnerMusic } from '../../lib/audio/runnerMusic';
import { sfx } from '../../lib/audio/sfx';
import { bestFor, type Profile, type RecordedSession } from '../../lib/storage';
import './ArcadeScreen.css';

export interface ArcadeRunResult {
  mode: string;
  score: number;
  accuracy: number;
  bestCombo: number;
  /** For the achievements. */
  facts: SessionFacts;
}

/** What a mini-game adds to the achievements: the boss counts its dodges and its longest run of them. */
function arcadeFacts(game: ArcadeGame, score: number): SessionFacts {
  if (game instanceof BossFight) return { dodges: game.dodges, perfectStreak: game.bestStreak, durationMs: game.time, score };
  const time = 'time' in game && typeof game.time === 'number' ? game.time : 0;
  return { dodges: 0, perfectStreak: 0, durationMs: time, score };
}

interface ArcadeScreenProps {
  engine: MotionEngine;
  mode: GameModeDef;
  difficulty: Difficulty;
  profile: Profile;
  onRecord: (run: ArcadeRunResult) => RecordedSession | null;
  onAgain: () => void;
  onModes: () => void;
}

/** How to play, three short lines per mini-game. */
const RULES: Record<ArcadeKind, string[]> = {
  stars: [
    'Звёзды вспыхивают вокруг тебя — коснись их рукой, пока кольцо не погасло',
    'Поймал быстро — бонус; серия из пяти поднимает множитель',
    'Красные бомбы не трогай: три бомбы — и раунд окончен',
  ],
  freeze: [
    'Зелёный — беги на месте: чем выше колени, тем быстрее к финишу (100 м)',
    '«Море волнуется»: жёлтый называет фигуру, на красный встань в неё и замри. Точная фигура — рывок на 6 м и очки, серия — множитель',
    'Шевельнулся — минус жизнь и 10 м назад, камера скажет, что двигалось. Бывают обманки: жёлтый снова станет зелёным',
  ],
  reaction: [
    'Встань ровно и жди сигнала — двигаться раньше нельзя',
    'Появилось движение — сделай его как можно быстрее',
    '10 раундов; фальстарт и не то движение добавляют штраф',
  ],
  squats: [
    '30 секунд — сколько полных приседаний успеешь',
    'Засчитывается присед до конца вниз и снова вверх',
    'Неглубоко или с наклоном — игра подскажет, как правильно',
  ],
  boss: [
    'Босс бьёт по полосам: красная полоса — уйди с неё шагом в сторону',
    'Луч на уровне головы — присядь, волна по полу — подпрыгни',
    'Три уклонения подряд — босс оглушён: обе руки вверх — удар. Пять ударов — победа',
  ],
};

const MUSIC: Record<ArcadeKind, boolean> = { stars: true, freeze: true, reaction: false, squats: true, boss: true };
const TOAST_MS = 2200;
const COUNTDOWN_STEP_MS = 700;

function createGame(kind: ArcadeKind, scheme: ControlScheme, tune: ArcadeTune): ArcadeGame {
  switch (kind) {
    case 'stars':
      return new StarCatch(undefined, tune);
    case 'freeze':
      return new FreezeGame(undefined, tune);
    case 'reaction':
      return new ReactionGame((move) => motionMeta(move, scheme).title);
    case 'squats':
      return new SquatGame();
    case 'boss':
      return new BossFight(undefined, tune);
  }
}

/** A stored score in this game's own terms. */
function formatScore(kind: ArcadeKind, score: number): string {
  if (kind === 'reaction') return `${3000 - score} мс`;
  if (kind === 'squats') return String(Math.round(score / 100));
  return score.toLocaleString('ru-RU');
}

type Stage = 'intro' | 'countdown' | 'playing' | 'done';

/**
 * One screen for all mini-games: the camera picture fills the stage, the game
 * draws on top of it, the HUD and the cue are DOM. Intro → stand in view →
 * 3-2-1 → play → result with this device's record.
 */
export function ArcadeScreen({ engine, mode, difficulty, profile, onRecord, onAgain, onModes }: ArcadeScreenProps) {
  const kind: ArcadeKind = mode.arcade ?? 'stars';
  const [level] = useState(() => effectiveDifficulty(mode, difficulty));
  const [game] = useState(() => createGame(kind, engine.ui.get().scheme, arcadeTune(level)));
  /** Lives at the start of the round (the difficulty may add or take one). */
  const [lives] = useState(() => game.hud().lives ?? 0);
  const [best] = useState(() => bestFor(profile, mode.id));
  const [music] = useState(() => new RunnerMusic());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ArcadeRenderer | null>(null);
  const events = useRef<GestureEvent[]>([]);
  const stageRef = useRef<Stage>('intro');
  const [stage, setStage] = useState<Stage>('intro');
  const seenSince = useRef<number | null>(null);
  const countdownAt = useRef(0);
  const countdownRef = useRef<number | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [hud, setHud] = useState<ArcadeHud>(() => game.hud());
  const hudKey = useRef('');
  const toastId = useRef(0);
  const [toast, setToast] = useState<ArcadeHud['toast']>(null);
  const ducked = useRef(false);
  const [result, setResult] = useState<ArcadeResult | null>(null);
  const [recorded, setRecorded] = useState<RecordedSession | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new ArcadeRenderer(canvas);
    rendererRef.current = renderer;
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(
    () => () => {
      music.stop();
      engine.setExpected(null);
    },
    [engine, music],
  );

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useGestureEvents(engine, (event) => {
    if (stageRef.current === 'playing') events.current.push(event);
  });

  const finish = () => {
    stageRef.current = 'done';
    music.stop();
    engine.setExpected(null);
    const r = game.result();
    setResult(r);
    setRecorded(onRecord({ mode: mode.id, score: r.score, accuracy: r.accuracy, bestCombo: r.bestCombo, facts: arcadeFacts(game, r.score) }));
    setStage('done');
  };

  useEngineFrame(engine, (frame, dt) => {
    const now = frame.time;
    if (stageRef.current === 'intro') {
      // Starts on its own once the player has been in view for a second.
      const seen = frame.trackable && frame.pose !== null;
      seenSince.current = seen ? (seenSince.current ?? now) : null;
      if (seenSince.current !== null && now - seenSince.current > 1000) {
        stageRef.current = 'countdown';
        countdownAt.current = now;
        countdownRef.current = 3;
        setCountdown(3);
        setStage('countdown');
        sfx.play('tick');
      }
    } else if (stageRef.current === 'countdown') {
      const left = 3 - Math.floor((now - countdownAt.current) / COUNTDOWN_STEP_MS);
      if (left <= 0) {
        stageRef.current = 'playing';
        countdownRef.current = null;
        setCountdown(null);
        setStage('playing');
        sfx.play('go');
        engine.setExpected(game.expected);
        if (MUSIC[kind]) music.start();
      } else if (left !== countdownRef.current) {
        countdownRef.current = left;
        setCountdown(left);
        sfx.play('tick');
      }
    } else if (stageRef.current === 'playing') {
      const hint = engine.ui.get().hint;
      const sounds = game.update(
        {
          pose: frame.trackable ? frame.pose : null,
          baseline: frame.baseline,
          aspect: frame.aspect,
          inferred: frame.inferred,
          events: events.current.splice(0),
          lateral: frame.lateral.phase === 'CONFIRMED' ? frame.lateral.gesture : null,
          vertical: frame.vertical.phase === 'CONFIRMED' ? frame.vertical.gesture : null,
          hint: hint && isErrorVerdict(hint.verdict) ? hint.message : null,
        },
        dt,
        now,
      );
      for (const s of sounds) {
        sfx.play(s);
        // The player's catches and dodges play along with the track.
        if (s === 'perfect') music.hit(true);
        else if (s === 'orb' || s === 'clear') music.hit(false);
        else if (s === 'miss') music.miss();
      }
      // A live move check for games whose expected move changes (the boss fight).
      engine.setExpected(game.expected);
      if (game.done) finish();
    }

    rendererRef.current?.render(game, frame, now);
    const next = game.hud();
    if (music.playing) {
      // The series builds the music; a timed game also grows with the clock.
      const byClock = Math.min(3, Math.floor((next.progress ?? 0) * 4));
      music.update(kind === 'squats' ? byClock : Math.max(comboLayers(next.combo), Math.min(1, byClock)));
      // Freeze!: the music drops when the light turns red — like the playground game.
      const duck = game instanceof FreezeGame && game.light === 'red';
      if (duck !== ducked.current) {
        ducked.current = duck;
        music.duck(duck);
      }
    }
    const key = JSON.stringify(next);
    if (key !== hudKey.current) {
      hudKey.current = key;
      setHud(next);
      if (next.toast && next.toast.id !== toastId.current) {
        toastId.current = next.toast.id;
        setToast(next.toast);
      }
    }
  });

  const playing = stage === 'playing';
  const cue = playing ? hud.cue : null;
  /** The record after this run (the side panel), or the one this screen opened with. */
  const record = recorded ? bestFor(recorded.profile, mode.id) : best;

  return (
    <main className={`screen arcade arcade--${kind}`} style={{ '--accent': mode.accent } as CSSProperties}>
      <section className="arcade__stage" aria-label={mode.title}>
        <CameraViewport engine={engine} variant="stage" hud={false} trail={kind === 'stars'} className="arcade__camera">
          <canvas ref={canvasRef} className="arcade__canvas" aria-hidden="true" />
        </CameraViewport>

        <div className="arcade__hud">
          <div className="arcade__top">
            <div className="arcade__stat">
              <span className="t-label">{hud.stat.label}</span>
              <strong>{hud.stat.value}</strong>
              {hud.combo >= 3 && playing && <span className="arcade__combo">серия {hud.combo}</span>}
            </div>
            <div className="arcade__right">
              {hud.lives !== null && lives > 0 && (
                <div className="arcade__lives" role="img" aria-label={`Жизни: ${hud.lives} из ${lives}`}>
                  {Array.from({ length: lives }, (_, i) => (
                    <span key={i} className={i < (hud.lives ?? 0) ? 'is-full' : ''}>
                      <ModeIcon name="heart" size={18} />
                    </span>
                  ))}
                </div>
              )}
              <strong className="arcade__counter">{hud.counter}</strong>
            </div>
          </div>
          {hud.boss && (
            <div className={`arcade__boss ${hud.boss.stunned ? 'is-stunned' : ''}`} role="img" aria-label={`Босс: ${hud.boss.hp} из ${hud.boss.max}`}>
              <span>{hud.boss.stunned ? 'Босс оглушён' : 'Босс'}</span>
              <div className="arcade__boss-hp">
                {Array.from({ length: hud.boss.max }, (_, i) => (
                  <i key={i} className={i < (hud.boss?.hp ?? 0) ? 'is-full' : undefined} />
                ))}
              </div>
            </div>
          )}
          {hud.progress !== null && (
            <div className={hud.runner ? 'arcade__progress has-runner' : 'arcade__progress'} aria-hidden="true">
              <div style={{ transform: `scaleX(${Math.min(1, Math.max(0, hud.progress))})` }} />
              {hud.runner && (
                <>
                  <span className="arcade__runner" style={{ left: `${Math.min(1, Math.max(0, hud.progress)) * 100}%` }}>
                    <ModeIcon name="run" size={20} />
                  </span>
                  <span className="arcade__flag" />
                </>
              )}
            </div>
          )}

          <AnimatePresence>
            {playing && hud.figure && (
              <motion.div
                key={`${hud.figure.name}${hud.figure.left}`}
                className="arcade__figure"
                data-state={hud.figure.state}
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <span className="arcade__figure-label">{hud.figure.state === 'soon' ? 'Морская фигура' : hud.figure.state === 'hit' ? 'Точно — замри!' : 'Замри в фигуре'}</span>
                <PoseGlyph pose={hud.figure} size={96} />
                <strong>{hud.figure.name}</strong>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="arcade__middle">
            <AnimatePresence mode="popLayout">
              {cue && (
                <motion.div
                  key={cue.text}
                  className="arcade__cue"
                  data-tone={cue.tone}
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 22 }}
                >
                  <strong>{cue.text}</strong>
                  {cue.sub && <span>{cue.sub}</span>}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="arcade__bottom">
            <AnimatePresence>
              {toast && playing && (
                <motion.p
                  key={toast.id}
                  className="arcade__toast"
                  data-tone={toast.tone}
                  role="status"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {toast.text}
                </motion.p>
              )}
            </AnimatePresence>
            {hud.meter && playing && (
              <div className={`arcade__meter ${hud.meter.danger ? 'is-danger' : ''}`}>
                <span>{hud.meter.label}</span>
                <div className="arcade__meter-track">
                  <div style={{ transform: `scaleX(${hud.meter.value})` }} />
                  {hud.meter.mark !== null && <i style={{ left: `${hud.meter.mark * 100}%` }} />}
                </div>
              </div>
            )}
          </div>
        </div>

        <AnimatePresence>
          {stage === 'intro' && (
            <motion.div key="intro" className="overlay arcade__intro" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <span className="arcade__badge-icon">
                <ModeIcon name={mode.icon} size={40} />
              </span>
              <p className="t-label">
                {mode.badge}
                {supportsDifficulty(mode) && ` · ${level.title}`}
              </p>
              <h2 className="t-headline">{mode.title}</h2>
              <p className="overlay__message">{mode.tagline}</p>
              {/* Phones: the side panel is hidden, so the rules are here. */}
              <ol className="arcade__intro-rules">
                {RULES[kind].map((rule, i) => (
                  <li key={rule}>
                    {i + 1}. {rule}
                  </li>
                ))}
              </ol>
              <p className="arcade__wait">Встань в кадр — игра начнётся сама</p>
            </motion.div>
          )}
          {countdown !== null && (
            <motion.span
              key={countdown}
              className="countdown arcade__countdown"
              initial={{ scale: 2, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
              {countdown}
            </motion.span>
          )}
        </AnimatePresence>

        {stage === 'done' && result && (
          <motion.div className="overlay arcade__results" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <p className="t-label">{mode.title} · итог</p>
            <h2 className="t-display arcade__headline">{result.headline}</h2>
            <p className="arcade__caption">{result.caption}</p>
            {recorded?.isNewBest ? (
              <span className="badge badge--success">Новый рекорд</span>
            ) : (
              best > 0 && <span className="arcade__record-line">Рекорд: {formatScore(kind, best)}</span>
            )}
            <ul className="arcade__lines">
              {result.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <div className="arcade__actions">
              <HoldGesture engine={engine} label="Ещё раз" onConfirm={onAgain} />
              <button type="button" className="btn btn--ghost btn--small" onClick={onModes}>
                <Icon name="left" size={16} /> Меню
              </button>
            </div>
          </motion.div>
        )}
      </section>

      <aside className="arcade__side">
        <div className="arcade__side-head">
          <span className="arcade__side-icon">
            <ModeIcon name={mode.icon} size={26} />
          </span>
          <div>
            <p className="t-label">{mode.badge}</p>
            <h2 className="arcade__title">{mode.title}</h2>
          </div>
        </div>
        <ol className="arcade__rules">
          {RULES[kind].map((rule, i) => (
            <li key={rule}>
              <span>{i + 1}</span>
              {rule}
            </li>
          ))}
        </ol>
        <p className="arcade__record">
          Рекорд на этом устройстве: <strong>{record > 0 ? formatScore(kind, record) : '—'}</strong>
        </p>
        <button type="button" className="btn btn--ghost btn--small arcade__exit" onClick={onModes}>
          <Icon name="left" size={16} /> В меню
        </button>
      </aside>
    </main>
  );
}
