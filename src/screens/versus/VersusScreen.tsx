import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CameraViewport } from '../../components/CameraViewport';
import { HoldGesture } from '../../components/HoldGesture';
import { Icon } from '../../components/Icon';
import type { MotionEngine, MotionFrame } from '../../features/engine/MotionEngine';
import { GameEngine, type GameEvent } from '../../features/gameplay/GameEngine';
import { isPickup, OBSTACLE_REQUIREMENT } from '../../features/gameplay/types';
import { motionMeta, schemeOf } from '../../features/gestures/types';
import { courseForMode, rulesForMode, type GameModeDef } from '../../features/modes/modes';
import { GameRenderer } from '../../features/render/GameRenderer';
import { PLAYER_COLORS } from '../../features/render/DanceRenderer';
import { computeSessionStats } from '../../features/results/sessionStats';
import { PlayerTracker, splitPlayers } from '../../features/versus/PlayerTracker';
import { useEngineFrame } from '../../hooks/useEngine';
import { sfx } from '../../lib/audio/sfx';
import './VersusScreen.css';

interface VersusScreenProps {
  engine: MotionEngine;
  mode: GameModeDef;
  onAgain: () => void;
  onModes: () => void;
}

interface SideHud {
  calibration: number;
  ready: boolean;
  visible: boolean;
  score: number;
  energy: number;
  combo: number;
  cue: string | null;
  miss: string | null;
  ended: boolean;
}

function sound(event: GameEvent): void {
  if (event.type === 'clear') sfx.play(event.quality === 'perfect' ? 'perfect' : 'clear');
  else if (event.type === 'miss') sfx.play('miss');
  else if (event.type === 'orb') sfx.play('orb');
  else if (event.type === 'powerup') sfx.play('powerup');
  else if (event.type === 'countdown') sfx.play(event.value === 0 ? 'go' : 'tick');
}

/**
 * Local two-player runner: both players share one camera — P1 plays in the left
 * half of the picture, P2 in the right half — and race the same course on
 * split screens. Each player has an independent recognition pipeline.
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
  const lastMiss = useRef<(string | null)[]>([null, null]);
  const [hud, setHud] = useState<SideHud[]>([]);
  const hudKey = useRef('');
  const [finished, setFinished] = useState(false);

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
    trackers.current ??= [new PlayerTracker({ x0: 0, x1: frame.aspect / 2 }), new PlayerTracker({ x0: frame.aspect / 2, x1: frame.aspect })];
    const [t1, t2] = trackers.current;
    if (!t1 || !t2) return;
    if (frame.inferred) {
      const [p1, p2] = splitPlayers(frame.people, frame.aspect);
      t1.update(p1, frame.time);
      t2.update(p2, frame.time);
    }
    const bothReady = t1.baseline !== null && t2.baseline !== null;

    const sides: SideHud[] = [t1, t2].map((t, i) => {
      const game = games[i] as GameEngine;
      const renderer = renderers.current[i];
      if (bothReady) {
        for (const event of game.update(dt, t.input())) {
          renderer?.handleEvent(event, frame.time);
          sound(event);
          if (event.type === 'miss') lastMiss.current[i] = event.reason.message;
          if (event.type === 'clear') lastMiss.current[i] = null;
        }
      }
      if (renderer) {
        const view = { ...frame, pose: t.pose, displayPose: t.pose, baseline: t.baseline, trackable: t.trackable, features: t.features } as MotionFrame;
        renderer.render(game, view, dt, frame.time);
      }
      const next = game.nextRequired;
      const scheme = schemeOf(t.baseline?.mode);
      const cue = next && !isPickup(next.kind) && game.phase === 'running' ? motionMeta(OBSTACLE_REQUIREMENT[next.kind], scheme).title : null;
      return {
        calibration: Math.round(t.calibration.progress * 100),
        ready: t.baseline !== null,
        visible: t.trackable,
        score: game.score,
        energy: game.energy,
        combo: game.combo,
        cue,
        miss: lastMiss.current[i] ?? null,
        ended: game.phase === 'ended',
      };
    });
    const key = JSON.stringify(sides);
    if (key !== hudKey.current) {
      hudKey.current = key;
      setHud(sides);
    }
    if (!finished && sides.every((s) => s.ended)) setFinished(true);
  });

  const setup = hud.length < 2 || hud.some((s) => !s.ready);
  const [a, b] = games;
  const winner = finished && a && b ? (a.score === b.score ? 0 : a.score > b.score ? 1 : 2) : null;

  return (
    <main className="screen versus">
      <div className="versus__stages">
        {[0, 1].map((i) => {
          const s = hud[i];
          return (
            <section key={i} className="versus__stage" style={{ '--pc': PLAYER_COLORS[i] } as CSSProperties} aria-label={`Игрок ${i + 1}`}>
              <canvas ref={(el) => void (backgrounds.current[i] = el)} className="game__canvas" aria-hidden="true" />
              <canvas ref={(el) => void (canvases.current[i] = el)} className="game__canvas" aria-hidden="true" />
              <div className="versus__hud">
                <div className="versus__top">
                  <span className="versus__tag">P{i + 1}</span>
                  <strong className="versus__score">{(s?.score ?? 0).toLocaleString('ru-RU')}</strong>
                  <div className="hud__energy" role="img" aria-label={`Энергия: ${s?.energy ?? mode.energy}`}>
                    {Array.from({ length: mode.energy }, (_, k) => (
                      <span key={k} className={`hud__cell ${k < (s?.energy ?? mode.energy) ? 'is-full' : ''}`} />
                    ))}
                  </div>
                </div>
                {s && s.combo >= 3 && <span className="versus__combo">{s.combo} combo</span>}
                {s?.miss && <p className="versus__miss">{s.miss}</p>}
                {s?.cue && (
                  <div className="versus__cue">
                    <span className="t-label">Дальше</span> <strong>{s.cue}</strong>
                  </div>
                )}
                {s?.ended && !finished && <p className="versus__done">Финиш — ждём соперника</p>}
                {!setup && s && !s.visible && !s.ended && <p className="versus__lost">Вернись в свою половину кадра</p>}
              </div>
            </section>
          );
        })}
      </div>

      <AnimatePresence>
        {setup && (
          <motion.div key="setup" className="overlay versus__setup" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <p className="t-label">{mode.title} · 2 игрока</p>
            <h2 className="t-headline">Встаньте рядом: P1 слева, P2 справа</h2>
            <div className="versus__cam">
              <CameraViewport engine={engine} variant="panel" hud={false} className="versus__camera" />
              <span className="versus__cam-label versus__cam-label--p1">P1</span>
              <span className="versus__cam-label versus__cam-label--p2">P2</span>
            </div>
            <div className="versus__calib">
              {[0, 1].map((i) => {
                const s = hud[i];
                return (
                  <div key={i} className="versus__calib-row" style={{ '--pc': PLAYER_COLORS[i] } as CSSProperties}>
                    <b>P{i + 1}</b>
                    <span className="versus__calib-bar">
                      <span style={{ width: `${s?.ready ? 100 : (s?.calibration ?? 0)}%` }} />
                    </span>
                    <span>{s?.ready ? 'готов' : s?.visible ? 'стой ровно, руки вниз' : 'не видно'}</span>
                  </div>
                );
              })}
            </div>
            <p className="overlay__message">Каждый управляет своим бегуном: перебегай влево-вправо в своей половине, прыгай и приседай.</p>
          </motion.div>
        )}
        {finished && (
          <motion.div key="end" className="overlay versus__end" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <h2 className="t-display">{winner === 0 ? 'Ничья!' : `Победил игрок ${winner}`}</h2>
            <div className="versus__results">
              {games.map((g, i) => {
                const stats = computeSessionStats(g.result());
                return (
                  <div key={i} className="dance__card" style={{ '--pc': PLAYER_COLORS[i] } as CSSProperties}>
                    <span className="t-label">Игрок {i + 1}</span>
                    <strong className="dance__card-score">{g.score.toLocaleString('ru-RU')}</strong>
                    <span>
                      Точность {Math.round(stats.accuracy * 100)}% · комбо {g.bestCombo}
                    </span>
                    {stats.needsWork && <span className="dance__weak">Слабое место: {motionMeta(stats.needsWork.motion, 'body').title}</span>}
                  </div>
                );
              })}
            </div>
            <div className="dance__actions">
              <HoldGesture engine={engine} label="Реванш" onConfirm={onAgain} />
              <button type="button" className="btn btn--ghost btn--small" onClick={onModes}>
                <Icon name="left" size={16} /> Режимы
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
