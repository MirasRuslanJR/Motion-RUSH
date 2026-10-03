import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { CameraViewport } from '../../components/CameraViewport';
import { HoldGesture } from '../../components/HoldGesture';
import { Icon } from '../../components/Icon';
import { PoseGlyph } from '../../components/PoseGlyph';
import {
  armAngles,
  BEAT_MS,
  danceAccuracy,
  DanceBodyTracker,
  DanceEngine,
  danceHint,
  DANCE_CONFIG,
  DANCE_POSES,
  type DanceInput,
  type DancerState,
} from '../../features/dance/dance';
import { scriptedChoreography, sectionAt } from '../../features/dance/choreography';
import { DanceMusic } from '../../features/dance/music';
import type { MotionEngine, MotionFrame } from '../../features/engine/MotionEngine';
import { extractGeometry } from '../../features/gestures/FeatureExtractor';
import { danceTune, type Difficulty } from '../../features/modes/difficulty';
import { effectiveDifficulty, type GameModeDef } from '../../features/modes/modes';
import { DanceRenderer, PLAYER_COLORS } from '../../features/render/DanceRenderer';
import type { Pose } from '../../features/tracking/landmarks';
import { StandGuide, STAND_ROOM_SW } from '../../features/versus/standZone';
import { useEngineFrame } from '../../hooks/useEngine';
import { clamp } from '../../lib/math/geometry';
import type { Profile, RecordedSession } from '../../lib/storage';
import { GlobalSubmit } from '../results/ResultsScreen';
import './DanceScreen.css';

export interface DanceRunResult {
  mode: string;
  scheme: 'body' | 'seated';
  score: number;
  bestCombo: number;
  accuracy: number;
  dancers: DancerState[];
}

interface DanceScreenProps {
  engine: MotionEngine;
  mode: GameModeDef;
  difficulty: Difficulty;
  profile: Profile;
  onRecord: (result: DanceRunResult) => RecordedSession | null;
  onProfile: (profile: Profile) => void;
  onAgain: () => void;
  onModes: () => void;
  onLeaderboard: () => void;
}

type Stage = 'waiting' | 'playing' | 'done';

/** Two players: P1 = left half of the picture, P2 = right half (each has its own tracker). */
function assignPlayers(frame: Readonly<MotionFrame>, players: number): (Pose | null)[] {
  if (players === 1) return [frame.trackable ? frame.pose : null];
  return [frame.players[0] ?? null, frame.players[1] ?? null];
}

function poseName(id: string): string {
  return DANCE_POSES.find((p) => p.id === id)?.title ?? id;
}

function strongestAndWeakest(d: DancerState): { best: string | null; worst: string | null } {
  const rows = Object.entries(d.perPose)
    .filter(([, s]) => s.attempts > 0)
    .map(([id, s]) => ({ id, rate: s.hits / s.attempts, attempts: s.attempts }))
    .sort((a, b) => b.rate - a.rate || b.attempts - a.attempts);
  const best = rows[0];
  const worst = rows[rows.length - 1];
  return {
    best: best && best.rate > 0 ? poseName(best.id) : null,
    worst: worst && worst.rate < 1 && worst !== best ? poseName(worst.id) : null,
  };
}

/** The coming pose cards with small figures — so the dancer can get ready for the next one. */
function NextPoses({ dance, currentId }: { dance: DanceEngine; currentId: number | null }) {
  const start = currentId === null ? 0 : dance.moves.findIndex((m) => m.id === currentId);
  const moves = start < 0 ? [] : dance.moves.slice(start, start + 3);
  if (moves.length === 0) return null;
  return (
    <section className="dance__next" aria-label="Следующие позы">
      <span className="t-label">Дальше</span>
      <ol>
        {moves.map((m, i) => (
          <li key={m.id} className={i === 0 ? 'is-now' : undefined}>
            <PoseGlyph pose={m.pose} size={40} />
            <span className="dance__next-name">{m.pose.title}</span>
            {i === 0 && <span className="dance__next-tag">сейчас</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

interface Hud {
  visible: boolean[];
  /** Two players before the music: "готов ✓", "не вижу" or where to move. */
  statuses: string[];
  /** Both dancers stand in their zones (or the single dancer is seen). */
  ready: boolean[];
  loading: boolean;
  scores: number[];
  combos: number[];
  multipliers: number[];
  hints: string[];
  countdown: number | null;
  /** Id of the pose card that is coming up now (drives the "next poses" list). */
  currentId: number | null;
  /** The part of the song playing now ("Припев"), null before the music. */
  section: string | null;
}

export function DanceScreen({ engine, mode, difficulty, profile, onRecord, onProfile, onAgain, onModes, onLeaderboard }: DanceScreenProps) {
  const players = mode.players;
  const [level] = useState(() => effectiveDifficulty(mode, difficulty));
  // A written choreography for the song: the same dance every time, denser on harder levels.
  const [dance] = useState(() => new DanceEngine(scriptedChoreography(level.id), players, danceTune(level)));
  const [music] = useState(() => new DanceMusic());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<DanceRenderer | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const visibleSince = useRef<number | null>(null);
  const [stage, setStage] = useState<Stage>('waiting');
  const stageRef = useRef<Stage>('waiting');
  const [hud, setHud] = useState<Hud>(() => ({
    visible: Array.from({ length: players }, () => false),
    statuses: Array.from({ length: players }, () => 'не вижу'),
    ready: Array.from({ length: players }, () => false),
    loading: players === 2,
    scores: Array.from({ length: players }, () => 0),
    combos: Array.from({ length: players }, () => 0),
    multipliers: Array.from({ length: players }, () => 1),
    hints: Array.from({ length: players }, () => ''),
    countdown: null,
    currentId: null,
    section: null,
  }));
  const hudRef = useRef(hud);
  const [recorded, setRecorded] = useState<RecordedSession | null>(null);
  const [result, setResult] = useState<DanceRunResult | null>(null);
  // Two dancers: each needs a spot in their half with room to stretch the arms out.
  const [guides] = useState(() => (players === 2 ? [new StandGuide(0, STAND_ROOM_SW.dance), new StandGuide(1, STAND_ROOM_SW.dance)] : []));
  const standZones = useCallback(() => (stageRef.current === 'waiting' ? guides.map((g) => g.zone) : []), [guides]);
  // Squats, jumps and steps are measured against where each dancer stands.
  const [bodies] = useState(() => Array.from({ length: players }, () => new DanceBodyTracker()));
  const lastFrameAt = useRef<number | null>(null);

  useEffect(() => {
    engine.setExpected(null);
    const release = players === 2 ? engine.claimTwoPlayers() : null;
    const canvas = canvasRef.current;
    if (canvas) rendererRef.current = new DanceRenderer(canvas);
    return () => {
      release?.();
      music.stop();
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [engine, music, players]);

  useEngineFrame(engine, (frame) => {
    const poses = assignPlayers(frame, players);
    const now = frame.time;
    const dt = lastFrameAt.current === null ? 0 : Math.min(200, now - lastFrameAt.current);
    lastFrameAt.current = now;
    let songTime = -1;

    if (stageRef.current === 'waiting') {
      if (frame.inferred) {
        guides.forEach((g, i) => {
          const pose = poses[i];
          g.update(pose ? extractGeometry(pose) : null, frame.aspect);
        });
      }
      const allVisible = poses.every((p) => p !== null) && guides.every((g) => g.placement === 'ok');
      visibleSince.current = allVisible ? (visibleSince.current ?? now) : null;
      if (visibleSince.current !== null && now - visibleSince.current > 800) {
        stageRef.current = 'playing';
        setStage('playing');
        music.start(150);
      }
    }

    if (stageRef.current === 'playing') {
      music.update();
      songTime = music.time;
    }
    // Where each dancer's body is against their standing spot; the spot holds still while a body move is coming.
    const upcoming = dance.current;
    const hold = songTime >= 0 && !!upcoming?.pose.body && songTime >= upcoming.at - DANCE_CONFIG.leadMs * 0.6;
    const offsets = poses.map((p, i) => bodies[i]?.update(p, dt, hold) ?? null);
    const inputs: (DanceInput | null)[] = poses.map((p, i) => (p ? { ...armAngles(p), body: offsets[i] } : null));

    if (stageRef.current === 'playing') {
      for (const j of dance.update(songTime, inputs)) rendererRef.current?.judged(j.player, j.grade, j.points, now);
      if (songTime > dance.duration) {
        stageRef.current = 'done';
        music.stop();
        const main = dance.dancers[0];
        const run: DanceRunResult = {
          mode: mode.id,
          scheme: engine.ui.get().scheme,
          score: main?.score ?? 0,
          bestCombo: main?.bestCombo ?? 0,
          accuracy: main ? danceAccuracy(main) : 0,
          dancers: dance.dancers.map((d) => ({ ...d, perPose: { ...d.perPose } })),
        };
        setResult(run);
        setRecorded(onRecord(run));
        setStage('done');
      }
    }

    const current = dance.current;
    rendererRef.current?.render(
      songTime,
      dance.moves,
      current,
      poses.map((p, i) => ({ pose: players === 1 ? (frame.trackable ? frame.displayPose : null) : p, combo: dance.dancers[i]?.combo ?? 0, offset: offsets[i] })),
      now,
    );
    if (progressRef.current) progressRef.current.style.transform = `scaleX(${clamp(songTime / dance.duration, 0, 1)})`;

    const introBeat = Math.floor(songTime / BEAT_MS);
    const next: Hud = {
      visible: poses.map((p) => p !== null),
      statuses: poses.map((p, i) => (!p ? 'не вижу' : (guides[i]?.message ?? 'готов ✓'))),
      ready: poses.map((p, i) => p !== null && (guides[i]?.placement ?? 'ok') === 'ok'),
      loading: players === 2 && frame.twoPlayer === 'loading',
      scores: dance.dancers.map((d) => d.score),
      combos: dance.dancers.map((d) => d.combo),
      multipliers: dance.dancers.map((_, i) => dance.multiplier(i)),
      // Error mode on the dance floor: what the body still has to do, which arm to move and which way.
      hints: inputs.map((a) => (current && songTime >= current.at - DANCE_CONFIG.leadMs * 0.6 ? danceHint(a, current.pose, dance.tune.tolerance) : '')),
      countdown: stageRef.current === 'playing' && introBeat >= 4 && introBeat < 8 ? 8 - introBeat : null,
      currentId: current?.id ?? null,
      section: songTime >= 0 && stageRef.current === 'playing' ? sectionAt(Math.floor(songTime / BEAT_MS)).title : null,
    };
    const prev = hudRef.current;
    const changed =
      next.countdown !== prev.countdown ||
      next.currentId !== prev.currentId ||
      next.section !== prev.section ||
      next.loading !== prev.loading ||
      next.visible.some((v, i) => v !== prev.visible[i]) ||
      next.statuses.some((v, i) => v !== prev.statuses[i]) ||
      next.scores.some((v, i) => v !== prev.scores[i]) ||
      next.combos.some((v, i) => v !== prev.combos[i]) ||
      next.hints.some((v, i) => v !== prev.hints[i]);
    if (changed) {
      hudRef.current = next;
      setHud(next);
    }
  });

  const winner = useMemo(() => {
    if (!result || players < 2) return null;
    const [a, b] = result.dancers;
    if (!a || !b) return null;
    return a.score === b.score ? 0 : a.score > b.score ? 1 : 2;
  }, [result, players]);

  return (
    <main className={`screen dance dance--p${players}`}>
      <section className="dance__stage" aria-label="Танцпол">
        <canvas ref={canvasRef} className="dance__canvas" aria-hidden="true" />

        <div className="dance__hud">
          <div className="dance__progress">
            <div ref={progressRef} className="dance__progress-fill" />
          </div>
          {/* Under the card timeline: scores at the sides, the part of the song between them. */}
          <div className="dance__top">
            {hud.scores.map((s, i) => (
              <div key={i} className={`dance__score dance__score--p${i + 1}`} style={{ '--pc': PLAYER_COLORS[i] } as CSSProperties}>
                <span className="t-label">{players === 1 ? mode.title : `Игрок ${i + 1}`}</span>
                <strong>{s.toLocaleString('ru-RU')}</strong>
                {(hud.combos[i] ?? 0) >= 3 && (
                  <span className="dance__combo">
                    комбо {hud.combos[i]} · ×{hud.multipliers[i]}
                  </span>
                )}
              </div>
            ))}
            {hud.section && (
              <p className="dance__section">
                {hud.section}
                <span>{level.title}</span>
              </p>
            )}
          </div>
          {stage === 'playing' && (
            <div className="dance__hints">
              {hud.hints.map((h, i) =>
                h ? (
                  <p key={i} className={`dance__hint ${h.startsWith('Точно') ? 'is-ok' : ''}`} style={{ '--pc': PLAYER_COLORS[i] } as CSSProperties}>
                    {players > 1 && <b>P{i + 1} · </b>}
                    {h}
                  </p>
                ) : null,
              )}
            </div>
          )}
        </div>

        <AnimatePresence>
          {stage === 'waiting' && (
            <motion.div key="wait" className="overlay dance__overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <p className="t-label">
                {mode.title} · {level.title}
              </p>
              <h2 className="t-headline">
                {players === 2 ? 'Встаньте вдвоём — каждый в свою подсвеченную зону' : 'Встань в кадр — музыка начнётся сама'}
              </h2>
              {players === 2 && (
                <div className="dance__who">
                  {hud.loading ? (
                    <span className="dance__who-loading">Включаем распознавание для двоих…</span>
                  ) : (
                    hud.statuses.map((s, i) => (
                      <span key={i} className={hud.ready[i] ? 'dance__who-chip is-on' : 'dance__who-chip'} style={{ '--pc': PLAYER_COLORS[i] } as CSSProperties}>
                        Игрок {i + 1}: {s}
                      </span>
                    ))
                  )}
                </div>
              )}
              <p className="overlay__message">Повторяй движение с карточки, когда она доедет до розовой рамки: позы рук, приседы, прыжки и шаги в сторону.</p>
            </motion.div>
          )}
          {hud.countdown !== null && (
            <motion.span
              key={hud.countdown}
              className="countdown dance__countdown"
              initial={{ scale: 2, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
              {hud.countdown}
            </motion.span>
          )}
        </AnimatePresence>

        {stage === 'done' && result && (
          <motion.div className="overlay dance__results" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {winner !== null ? (
              <h2 className="t-display dance__winner">{winner === 0 ? 'Ничья!' : `Победил игрок ${winner}`}</h2>
            ) : (
              <>
                <p className="t-label">{mode.title} · результат</p>
                <h2 className="t-display dance__winner">{result.score.toLocaleString('ru-RU')}</h2>
                {recorded?.isNewBest && <span className="badge badge--success">Новый рекорд</span>}
              </>
            )}
            <div className="dance__cards">
              {result.dancers.map((d, i) => {
                const { best, worst } = strongestAndWeakest(d);
                return (
                  <div key={i} className="dance__card" style={{ '--pc': PLAYER_COLORS[i] } as CSSProperties}>
                    {players > 1 && <span className="t-label">Игрок {i + 1}</span>}
                    <strong className="dance__card-score">{d.score.toLocaleString('ru-RU')}</strong>
                    <span>
                      Точность {Math.round(danceAccuracy(d) * 100)}% · идеально {d.perfect} · хорошо {d.good} · мимо {d.miss}
                    </span>
                    <span>Лучшее комбо: {d.bestCombo}</span>
                    {best && <span>Лучше всего: {best}</span>}
                    {worst && <span className="dance__weak">Потренируй: {worst}</span>}
                  </div>
                );
              })}
            </div>
            {players === 1 && mode.ranked && (
              <GlobalSubmit result={result} accuracy={result.accuracy} profile={profile} onProfile={onProfile} onLeaderboard={onLeaderboard} />
            )}
            <div className="dance__actions">
              <HoldGesture engine={engine} label="Ещё раз" onConfirm={onAgain} />
              <button type="button" className="btn btn--ghost btn--small" onClick={onModes}>
                <Icon name="left" size={16} /> Меню
              </button>
              <button type="button" className="btn btn--ghost btn--small" onClick={onLeaderboard}>
                Рейтинг
              </button>
            </div>
          </motion.div>
        )}
      </section>

      <aside className="dance__side">
        <div className={players === 2 ? 'dance__cam-wrap is-split' : 'dance__cam-wrap'}>
          <CameraViewport engine={engine} variant="panel" hud={false} standZones={players === 2 ? standZones : undefined} className="dance__camera" />
          {players === 2 && (
            <>
              <span className="dance__cam-label dance__cam-label--p1">P1</span>
              <span className="dance__cam-label dance__cam-label--p2">P2</span>
            </>
          )}
        </div>
        {stage !== 'done' && <NextPoses dance={dance} currentId={hud.currentId} />}
        <p className="dance__tip">
          {players === 2
            ? 'Игрок 1 — слева, игрок 2 — справа, оба видны хотя бы по пояс. В подсвеченной зоне хватает места развести руки и шагнуть в сторону; если игра просит отойти — шагните назад.'
            : 'Танцуй всем телом: позы рук, приседы, прыжки и шаги в сторону. Пунктирная фигура показывает, куда двигаться.'}
        </p>
      </aside>
    </main>
  );
}
