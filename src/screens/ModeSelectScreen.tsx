import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { CameraViewport } from '../components/CameraViewport';
import { HoldGesture } from '../components/HoldGesture';
import { Icon } from '../components/Icon';
import { ModeIcon } from '../components/ModeIcon';
import { NicknameField } from '../components/NicknameField';
import { GESTURE_CONFIG } from '../config/gesture.config';
import type { MotionEngine } from '../features/engine/MotionEngine';
import { lateralOffset } from '../features/gestures/thresholds';
import { GAME_MODES, MODE_CATEGORIES, type GameModeDef, type GameModeId, type ModeCategory } from '../features/modes/modes';
import { useEngineFrame, useGestureEvents, useMotionUi } from '../hooks/useEngine';
import { sfx } from '../lib/audio/sfx';
import { loopOffset, mod, releaseVelocity, swipeSteps } from '../lib/carousel';
import { clamp } from '../lib/math/geometry';
import { bestFor, type Profile } from '../lib/storage';
import { ONLINE_ENABLED } from '../lib/supabase';
import './ModeSelectScreen.css';

interface ModeSelectScreenProps {
  engine: MotionEngine;
  profile: Profile;
  initialMode: GameModeId;
  onSelect: (mode: GameModeId) => void;
  onLeaderboard: () => void;
  onProfile: (profile: Profile) => void;
}

/** 1 жизнь · 3 жизни · 5 жизней */
function lives(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  const word = d === 1 && dd !== 11 ? 'жизнь' : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? 'жизни' : 'жизней';
  return `${n} ${word}`;
}

function unavailable(mode: GameModeDef, profile: Profile): string | null {
  if (!mode.online) return null;
  if (!ONLINE_ENABLED) return 'Онлайн не настроен';
  if (profile.nickname.length < 2) return 'Сначала введи ник';
  return null;
}

function metaOf(mode: GameModeDef): string {
  const parts: string[] = [];
  if (mode.players === 2) parts.push('2 игрока');
  if (mode.facts) parts.push(mode.facts);
  else if (mode.kind === 'dance') parts.push('танец');
  else parts.push(mode.practice ? 'без штрафов' : lives(mode.energy));
  return parts.join(' · ');
}

const GAP = 18;
/** Cards further than this from the centre are hidden (they may jump around the loop). */
const VISIBLE_RANGE = 2.6;
/** Standing in a side zone keeps browsing: first repeat after this long… */
const REPEAT_DELAY_MS = 900;
/** …then one card per interval. */
const REPEAT_EVERY_MS = 650;
/** Trackpad / wheel: accumulated px per card, and the pause that ends one gesture. */
const WHEEL_STEP_PX = 90;
const WHEEL_IDLE_MS = 180;

interface Drag {
  id: number;
  x0: number;
  y0: number;
  card: number | null;
  moved: boolean;
  samples: { x: number; t: number }[];
}

function vibrate(): void {
  try {
    navigator.vibrate?.(8);
  } catch {
    // Not supported — fine.
  }
}

/**
 * Mode carousel — an endless loop of cards.
 *   touch / mouse: drag follows the finger, a flick carries momentum, a long fling skips cards
 *   trackpad / wheel: horizontal swipe, one card per ~90 px
 *   keyboard: ← → Home End Enter
 *   camera: step (or lean) to a side to browse, stay there to keep scrolling, jump to start
 */
export function ModeSelectScreen({ engine, profile, initialMode, onSelect, onLeaderboard, onProfile }: ModeSelectScreenProps) {
  const scheme = useMotionUi(engine, (s) => s.scheme);
  const [category, setCategory] = useState<ModeCategory | 'all'>('all');
  const list = useMemo(() => (category === 'all' ? GAME_MODES : GAME_MODES.filter((m) => m.category === category)), [category]);
  const N = list.length;
  const [index, setIndex] = useState(() => Math.max(0, GAME_MODES.findIndex((m) => m.id === initialMode)));
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [stepPx, setStepPx] = useState(340 + GAP);
  const drag = useRef<Drag | null>(null);
  const wheel = useRef({ acc: 0, last: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLSpanElement>(null);
  const hold = useRef<{ since: number | null; last: number }>({ since: null, last: 0 });
  const armedAt = useRef(Number.POSITIVE_INFINITY);
  const selected = mod(index, N);
  const mode = list[selected] ?? (list[0] as GameModeDef);

  /** A category chip narrows the carousel; the current mode stays selected if it is in the group. */
  const pickCategory = (next: ModeCategory | 'all') => {
    const nextList = next === 'all' ? GAME_MODES : GAME_MODES.filter((m) => m.category === next);
    setCategory(next);
    setIndex(Math.max(0, nextList.findIndex((m) => m.id === mode.id)));
    sfx.play('step');
  };
  const blocked = unavailable(mode, profile);

  const go = useCallback((step: number) => {
    if (step === 0) return;
    setIndex((i) => i + step);
    sfx.play('step');
    vibrate();
  }, []);

  const start = useCallback(
    (target: GameModeDef) => {
      if (unavailable(target, profile)) return;
      sfx.play('confirm');
      onSelect(target.id);
    },
    [onSelect, profile],
  );

  useEffect(() => {
    armedAt.current = performance.now() + 900;
    engine.setExpected(null);
  }, [engine]);

  // Card width follows the viewport (CSS clamps it); measure it for the swipe maths.
  // Measured on any rendered card — the set of cards changes with the category filter.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => {
      const card = viewport.querySelector<HTMLElement>('.mode-card');
      if (card && card.offsetWidth > 0) setStepPx(card.offsetWidth + GAP);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [list]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'Home') setIndex((i) => i - mod(i, N));
      else if (e.key === 'End') setIndex((i) => i - mod(i, N) + N - 1);
      else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) start(mode);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, start, mode, N]);

  useGestureEvents(engine, (event) => {
    if (event.phase !== 'start' || event.timestamp < armedAt.current) return;
    if (event.type === 'LEAN_LEFT') go(-1);
    else if (event.type === 'LEAN_RIGHT') go(1);
  });

  // Camera: keep scrolling while the player stays in a side zone; show where they stand.
  useEngineFrame(engine, (frame) => {
    const lat = frame.lateral;
    const side = lat.phase === 'CONFIRMED' ? (lat.gesture === 'LEAN_LEFT' ? -1 : lat.gesture === 'LEAN_RIGHT' ? 1 : 0) : 0;
    const h = hold.current;
    if (side !== 0 && frame.time >= armedAt.current) {
      h.since ??= frame.time;
      if (frame.time - h.since >= REPEAT_DELAY_MS && frame.time - h.last >= REPEAT_EVERY_MS) {
        h.last = frame.time;
        go(side);
      }
    } else {
      h.since = null;
    }
    const marker = markerRef.current;
    if (!marker) return;
    const f = frame.features;
    if (!frame.trackable || !f) {
      marker.style.opacity = '0';
      return;
    }
    // Map the lane metric so the lane borders sit at the painted zone borders (±0.3).
    const body = scheme === 'body';
    const activation = body ? GESTURE_CONFIG.body.step.activation : GESTURE_CONFIG.lean.activation;
    const raw = lateralOffset(f, scheme);
    const pos = clamp(body ? raw : (raw / activation) * 0.3, -1, 1);
    marker.style.opacity = '1';
    marker.style.left = `${50 + pos * 50}%`;
    marker.dataset.side = side < 0 ? 'left' : side > 0 ? 'right' : 'center';
  });

  const endDrag = (commit: boolean, x: number) => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    setDragX(0);
    if (!d || !commit) return;
    const dx = x - d.x0;
    if (d.moved) {
      go(swipeSteps(dx, releaseVelocity(d.samples), stepPx));
    } else if (d.card !== null) {
      // A tap: the centred card starts the mode, a side card scrolls to it.
      const offset = loopOffset(d.card, selected, N);
      if (offset === 0) start(mode);
      else go(offset);
    }
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || drag.current) return;
    const card = (e.target as HTMLElement).closest<HTMLElement>('[data-index]');
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, card: card ? Number(card.dataset.index) : null, moved: false, samples: [{ x: e.clientX, t: e.timeStamp }] };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Pointer already gone (or synthetic) — the drag still works without capture.
    }
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(e.clientY - d.y0)) {
      d.moved = true;
      setDragging(true);
    }
    d.samples.push({ x: e.clientX, t: e.timeStamp });
    if (d.samples.length > 8) d.samples.shift();
    // Past the neighbours the drag resists (rubber band), so a fling never loses the cards.
    if (d.moved) setDragX(Math.abs(dx) > stepPx * 2.5 ? Math.sign(dx) * (stepPx * 2.5 + (Math.abs(dx) - stepPx * 2.5) * 0.3) : dx);
  };

  return (
    <main className="screen modes">
      <aside className="modes__side">
        <CameraViewport engine={engine} variant="pip" hud={false} className="modes__camera" />
        <p className="t-label">Управление</p>
        <ul className="modes__howto">
          <li>
            <Icon name="left" size={16} />
            <Icon name="right" size={16} />
            {scheme === 'body' ? 'Перейди влево / вправо — листать, постой там — листает дальше' : 'Наклон влево / вправо — листать'}
          </li>
          <li>
            <Icon name="up" size={16} />
            {scheme === 'body' ? 'Подпрыгни — старт' : 'Руки вверх и держать — старт'}
          </li>
          <li>
            <Icon name="users" size={16} />
            Свайп, колесо, стрелки ← → и Enter
          </li>
        </ul>
        <NicknameField value={profile.nickname} onSaved={(nickname) => onProfile({ ...profile, nickname })} compact />
        <button type="button" className="btn btn--ghost btn--small" onClick={onLeaderboard}>
          <Icon name="bolt" size={16} /> Рейтинг игроков
        </button>
      </aside>

      <section className="modes__main">
        <p className="t-label">
          Выбери режим · {selected + 1} / {N} · {scheme === 'body' ? 'всё тело' : 'сидя'}
        </p>
        <div className="modes__filters" role="group" aria-label="Категории режимов">
          {([{ id: 'all', title: 'Все' }, ...MODE_CATEGORIES] as const).map((c) => (
            <button key={c.id} type="button" className={category === c.id ? 'chip is-active' : 'chip'} onClick={() => pickCategory(c.id)} aria-pressed={category === c.id}>
              {c.title}
            </button>
          ))}
        </div>
        <p className="sr-only" aria-live="polite">
          {mode.title}. {mode.tagline}
        </p>

        <div className="carousel" aria-roledescription="carousel" aria-label="Режимы игры">
          <button type="button" className="carousel__arrow carousel__arrow--prev" onClick={() => go(-1)} aria-label="Предыдущий режим">
            <Icon name="left" size={22} />
          </button>
          <div
            ref={viewportRef}
            className={`carousel__viewport ${dragging ? 'is-dragging' : ''}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => endDrag(true, e.clientX)}
            onPointerCancel={(e) => endDrag(false, e.clientX)}
            onLostPointerCapture={(e) => drag.current && endDrag(true, e.clientX)}
            onWheel={(e) => {
              const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
              if (delta === 0) return;
              const w = wheel.current;
              if (e.timeStamp - w.last > WHEEL_IDLE_MS) w.acc = 0;
              w.last = e.timeStamp;
              w.acc += delta;
              if (Math.abs(w.acc) >= WHEEL_STEP_PX) {
                go(Math.sign(w.acc));
                w.acc = 0;
              }
            }}
          >
            {list.map((m, i) => {
              const why = unavailable(m, profile);
              const best = bestFor(profile, m.id);
              const pos = loopOffset(i, selected, N) + dragX / stepPx;
              const dist = Math.abs(pos);
              const hidden = dist > VISIBLE_RANGE;
              const style = {
                '--accent': m.accent,
                transform: `translateX(calc(-50% + ${pos * stepPx}px)) scale(${1 - Math.min(dist, 1.5) * 0.09})`,
                opacity: hidden ? 0 : Math.max(0.08, 1 - dist * 0.42),
                zIndex: 10 - Math.round(dist),
                visibility: hidden ? 'hidden' : 'visible',
              } as CSSProperties;
              return (
                <article
                  key={m.id}
                  data-index={i}
                  className={`mode-card ${i === selected ? 'is-selected' : ''} ${why ? 'is-locked' : ''}`}
                  style={style}
                  aria-current={i === selected}
                  aria-hidden={hidden}
                  aria-label={m.title}
                >
                  <span className="mode-card__mark" aria-hidden="true">
                    <ModeIcon name={m.icon} size={170} />
                  </span>
                  <span className="mode-card__head">
                    <span className="mode-card__icon">
                      <ModeIcon name={m.icon} size={26} />
                    </span>
                    <span className="mode-card__badge">{m.badge}</span>
                  </span>
                  <span className="mode-card__title">{m.title}</span>
                  <span className="mode-card__tagline">{m.tagline}</span>
                  <span className="mode-card__goal">{m.goal}</span>
                  <span className="mode-card__meta">
                    {why ?? metaOf(m)}
                    {best > 0 && !why && <strong> · рекорд {best.toLocaleString('ru-RU')}</strong>}
                  </span>
                </article>
              );
            })}
          </div>
          <button type="button" className="carousel__arrow carousel__arrow--next" onClick={() => go(1)} aria-label="Следующий режим">
            <Icon name="right" size={22} />
          </button>
        </div>

        <div className="carousel__dots" role="tablist" aria-label="Все режимы">
          {list.map((m, i) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={i === selected}
              aria-label={m.title}
              className={i === selected ? 'is-active' : ''}
              style={{ '--accent': m.accent } as CSSProperties}
              onClick={() => go(loopOffset(i, selected, N))}
            />
          ))}
        </div>

        <div className="carousel__body" aria-hidden="true" title="Где ты стоишь в кадре">
          <span className="carousel__zone">◀ листать</span>
          <span className="carousel__zone carousel__zone--center">центр</span>
          <span className="carousel__zone">листать ▶</span>
          <span ref={markerRef} className="carousel__marker" />
        </div>

        <div className="modes__start">
          {blocked ? (
            <p className="modes__blocked">{blocked}</p>
          ) : (
            <HoldGesture key={mode.id} engine={engine} label={`Играть: ${mode.title}`} onConfirm={() => start(mode)} />
          )}
        </div>
      </section>
    </main>
  );
}
