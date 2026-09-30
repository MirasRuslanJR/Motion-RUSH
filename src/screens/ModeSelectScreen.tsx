import { motion } from 'motion/react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
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

/** Mode carousel controlled by the body: step / lean to browse, jump / arms up to start. */
export function ModeSelectScreen({ engine, profile, initialMode, onSelect, onLeaderboard, onProfile }: ModeSelectScreenProps) {
  const scheme = useMotionUi(engine, (s) => s.scheme);
  const [index, setIndex] = useState(() => Math.max(0, GAME_MODES.findIndex((m) => m.id === initialMode)));
  const mode = GAME_MODES[index] ?? (GAME_MODES[0] as GameModeDef);
  const blocked = unavailable(mode, profile);
  const armedAt = useRef(Number.POSITIVE_INFINITY);

  useEffect(() => {
    armedAt.current = performance.now() + 900;
    engine.setExpected(null);
  }, [engine]);

  useGestureEvents(engine, (event) => {
    if (event.phase !== 'start' || event.timestamp < armedAt.current) return;
    if (event.type === 'LEAN_LEFT' || event.type === 'LEAN_RIGHT') {
      const step = event.type === 'LEAN_LEFT' ? -1 : 1;
      setIndex((i) => (i + step + GAME_MODES.length) % GAME_MODES.length);
      sfx.play('step');
    }
  });

  const start = (target: GameModeDef) => {
    if (unavailable(target, profile)) return;
    sfx.play('confirm');
    onSelect(target.id);
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
            {scheme === 'body' ? 'Шаг влево / вправо — выбор' : 'Наклон влево / вправо — выбор'}
          </li>
          <li>
            <Icon name="up" size={16} />
            {scheme === 'body' ? 'Подпрыгни — старт' : 'Руки вверх и держать — старт'}
          </li>
        </ul>
        <NicknameField value={profile.nickname} onSaved={(nickname) => onProfile({ ...profile, nickname })} compact />
        <button type="button" className="btn btn--ghost btn--small" onClick={onLeaderboard}>
          <Icon name="bolt" size={16} /> Рейтинг игроков
        </button>
      </aside>

      <section className="modes__main">
        <p className="t-label">Выбери режим · {scheme === 'body' ? 'всё тело' : 'сидя'}</p>
        <h1 className="t-headline">{mode.title}</h1>
        <p className="modes__tagline">{mode.tagline}</p>

        <div className="modes__grid" role="listbox" aria-label="Режимы игры">
          {GAME_MODES.map((m, i) => {
            const why = unavailable(m, profile);
            const best = bestFor(profile, m.id);
            return (
              <motion.button
                key={m.id}
                type="button"
                role="option"
                aria-selected={i === index}
                className={`mode-card ${i === index ? 'is-selected' : ''} ${why ? 'is-locked' : ''}`}
                style={{ '--accent': m.accent } as CSSProperties}
                onClick={() => (i === index ? start(m) : setIndex(i))}
                layout
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              >
                <span className="mode-card__title">{m.title}</span>
                <span className="mode-card__goal">{m.goal}</span>
                <span className="mode-card__meta">
                  {why ?? (m.practice ? 'без штрафов' : lives(m.energy))}
                  {best > 0 && !why && <strong> · рекорд {best.toLocaleString('ru-RU')}</strong>}
                </span>
              </motion.button>
            );
          })}
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
