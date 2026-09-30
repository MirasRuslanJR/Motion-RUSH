import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { CameraViewport } from '../components/CameraViewport';
import { HoldGesture } from '../components/HoldGesture';
import { Icon } from '../components/Icon';
import { NicknameField } from '../components/NicknameField';
import type { MotionEngine } from '../features/engine/MotionEngine';
import { GAME_MODES, type GameModeDef, type GameModeId } from '../features/modes/modes';
import { useGestureEvents, useMotionUi } from '../hooks/useEngine';
import { sfx } from '../lib/audio/sfx';
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
  if (mode.kind === 'dance') parts.push('танец');
  else parts.push(mode.practice ? 'без штрафов' : lives(mode.energy));
  return parts.join(' · ');
}

/** Swipe distance (px) that flips to the next card. */
const SWIPE_PX = 50;

/**
 * Mode carousel. Browse by stepping left/right in front of the camera,
 * swiping (touch / mouse drag / trackpad) or the arrow keys; start with a jump.
 */
export function ModeSelectScreen({ engine, profile, initialMode, onSelect, onLeaderboard, onProfile }: ModeSelectScreenProps) {
  const scheme = useMotionUi(engine, (s) => s.scheme);
  const [index, setIndex] = useState(() => Math.max(0, GAME_MODES.findIndex((m) => m.id === initialMode)));
  const [dragX, setDragX] = useState(0);
  const drag = useRef<{ x: number; card: number | null; moved: boolean } | null>(null);
  const wheelAt = useRef(0);
  const mode = GAME_MODES[index] ?? (GAME_MODES[0] as GameModeDef);
  const blocked = unavailable(mode, profile);
  const armedAt = useRef(Number.POSITIVE_INFINITY);

  const go = useCallback((step: number) => {
    setIndex((i) => (i + step + GAME_MODES.length) % GAME_MODES.length);
    sfx.play('step');
  }, []);

  useEffect(() => {
    armedAt.current = performance.now() + 900;
    engine.setExpected(null);
  }, [engine]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  useGestureEvents(engine, (event) => {
    if (event.phase !== 'start' || event.timestamp < armedAt.current) return;
    if (event.type === 'LEAN_LEFT') go(-1);
    else if (event.type === 'LEAN_RIGHT') go(1);
  });

  const start = (target: GameModeDef) => {
    if (unavailable(target, profile)) return;
    sfx.play('confirm');
    onSelect(target.id);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('[data-index]');
    drag.current = { x: e.clientX, card: card ? Number(card.dataset.index) : null, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 6) d.moved = true;
    setDragX(dx);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    setDragX(0);
    if (!d) return;
    const dx = e.clientX - d.x;
    if (dx <= -SWIPE_PX) go(1);
    else if (dx >= SWIPE_PX) go(-1);
    else if (!d.moved && d.card !== null) {
      // A tap: on the centred card it starts the mode, on a side card it scrolls to it.
      if (d.card === index) start(mode);
      else setIndex(d.card);
    }
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
            {scheme === 'body' ? 'Перейди влево / вправо — листать' : 'Наклон влево / вправо — листать'}
          </li>
          <li>
            <Icon name="up" size={16} />
            {scheme === 'body' ? 'Подпрыгни — старт' : 'Руки вверх и держать — старт'}
          </li>
          <li>
            <Icon name="users" size={16} />
            Или свайпай карточки
          </li>
        </ul>
        <NicknameField value={profile.nickname} onSaved={(nickname) => onProfile({ ...profile, nickname })} compact />
        <button type="button" className="btn btn--ghost btn--small" onClick={onLeaderboard}>
          <Icon name="bolt" size={16} /> Рейтинг игроков
        </button>
      </aside>

      <section className="modes__main">
        <p className="t-label">
          Выбери режим · {index + 1} / {GAME_MODES.length} · {scheme === 'body' ? 'всё тело' : 'сидя'}
        </p>

        <div className="carousel" aria-roledescription="carousel" aria-label="Режимы игры">
          <button type="button" className="carousel__arrow carousel__arrow--prev" onClick={() => go(-1)} aria-label="Предыдущий режим">
            <Icon name="left" size={22} />
          </button>
          <div
            className={`carousel__viewport ${dragX !== 0 ? 'is-dragging' : ''}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              drag.current = null;
              setDragX(0);
            }}
            onWheel={(e) => {
              const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0;
              const now = performance.now();
              if (Math.abs(delta) < 20 || now - wheelAt.current < 350) return;
              wheelAt.current = now;
              go(delta > 0 ? 1 : -1);
            }}
          >
            <div className="carousel__track" style={{ '--i': index, '--drag': `${dragX}px` } as CSSProperties}>
              {GAME_MODES.map((m, i) => {
                const why = unavailable(m, profile);
                const best = bestFor(profile, m.id);
                const offset = i - index;
                return (
                  <article
                    key={m.id}
                    data-index={i}
                    className={`mode-card ${i === index ? 'is-selected' : ''} ${why ? 'is-locked' : ''} ${Math.abs(offset) > 2 ? 'is-far' : ''}`}
                    style={{ '--accent': m.accent } as CSSProperties}
                    aria-current={i === index}
                    aria-label={m.title}
                  >
                    <span className="mode-card__badge">{m.badge}</span>
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
          </div>
          <button type="button" className="carousel__arrow carousel__arrow--next" onClick={() => go(1)} aria-label="Следующий режим">
            <Icon name="right" size={22} />
          </button>
        </div>

        <div className="carousel__dots" aria-hidden="true">
          {GAME_MODES.map((m, i) => (
            <span key={m.id} className={i === index ? 'is-active' : ''} style={{ '--accent': m.accent } as CSSProperties} />
          ))}
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
