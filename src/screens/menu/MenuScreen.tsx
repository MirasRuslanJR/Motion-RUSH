import { motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { CameraViewport } from '../../components/CameraViewport';
import { DemoFigure } from '../../components/DemoFigure';
import { HoldGesture } from '../../components/HoldGesture';
import { Icon } from '../../components/Icon';
import { ModeIcon } from '../../components/ModeIcon';
import { NicknameField } from '../../components/NicknameField';
import type { MotionEngine } from '../../features/engine/MotionEngine';
import { DIAGNOSIS_RULES } from '../../features/gestures/diagnosisRules';
import { BODY_MOTION_META, type ExpectedMotion } from '../../features/gestures/types';
import { DIFFICULTIES, difficultyOf, livesAt, type Difficulty } from '../../features/modes/difficulty';
import { modeArt } from '../../features/modes/modeArt';
import { GAME_MODES, getMode, supportsDifficulty, type GameModeDef, type GameModeId, type ModeCategory } from '../../features/modes/modes';
import { useGestureEvents } from '../../hooks/useEngine';
import { MenuMusic } from '../../lib/audio/menuMusic';
import { sfx } from '../../lib/audio/sfx';
import { isCameraApiAvailable } from '../../lib/env';
import { bestFor, saveDifficulty, type Profile } from '../../lib/storage';
import { ONLINE_ENABLED } from '../../lib/supabase';
import { MenuScene } from './MenuScene';
import './MenuScreen.css';

type ItemId = 'play' | 'run' | 'arcade' | 'dance' | 'duo' | 'online' | 'leaderboard' | 'tutorial' | 'about';

interface MenuItem {
  id: ItemId;
  title: string;
  /** Line above the panel title. */
  eyebrow: string;
  modes: readonly GameModeId[];
}

const byCategory = (c: ModeCategory) => GAME_MODES.filter((m) => m.category === c).map((m) => m.id);
const HITS: readonly GameModeId[] = ['classic', 'dance', 'stars', 'freeze', 'versus'];

const ITEMS: readonly MenuItem[] = [
  { id: 'play', title: 'Играть', eyebrow: 'Быстрый старт · лучшие режимы', modes: HITS },
  { id: 'run', title: 'Забег', eyebrow: 'Беги, прыгай, приседай', modes: byCategory('run') },
  { id: 'arcade', title: 'Мини-игры', eyebrow: 'Короткие раунды', modes: byCategory('arcade') },
  { id: 'dance', title: 'Танцпол', eyebrow: 'Хореография под музыку', modes: ['dance', 'dance-duo'] },
  { id: 'duo', title: 'Вдвоём', eyebrow: 'Двое у одной камеры', modes: ['versus', 'dance-duo'] },
  { id: 'online', title: 'Онлайн-дуэль', eyebrow: 'Один на один по сети', modes: ['duel'] },
  { id: 'leaderboard', title: 'Рейтинг', eyebrow: 'Лучшие игроки', modes: [] },
  { id: 'tutorial', title: 'Обучение', eyebrow: 'Четыре движения за минуту', modes: [] },
  { id: 'about', title: 'Как играть', eyebrow: 'Камера вместо джойстика', modes: [] },
];

/** Items that open a screen right away instead of showing modes. */
const ACTION_ITEMS: readonly ItemId[] = ['leaderboard', 'tutorial'];

type Move = Exclude<ExpectedMotion, 'CENTER'>;
const MOVES: Move[] = ['LEAN_LEFT', 'LEAN_RIGHT', 'JUMP', 'CROUCH'];

const HOW_TO: { title: string; text: string }[] = [
  { title: 'Разреши камеру', text: 'Видео остаётся в браузере — мы его не записываем и никуда не отправляем.' },
  { title: 'Отойди на 2–3 шага', text: 'Чтобы камера видела тебя целиком. Можно и сидя — игра подстроится.' },
  { title: 'Двигайся', text: 'Перебегай, прыгай, приседай, танцуй. Ошибёшься — игра подскажет, как правильно.' },
];

const STATS = [
  { value: String(GAME_MODES.length), label: 'режимов' },
  { value: String(DIAGNOSIS_RULES.length), label: 'правил подсказок' },
  { value: '2', label: 'игрока у камеры' },
  { value: '0', label: 'кадров в сеть' },
];

/** Why a difficulty does not apply to a mode. */
function fixedLevelNote(mode: GameModeDef): string {
  if (mode.practice) return 'Тренировка всегда медленная и без штрафов';
  if (mode.online) return 'В дуэли у обоих одна и та же трасса';
  return 'Здесь результат — твоё время и счёт, сложность не меняется';
}

function lives(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  const word = d === 1 && dd !== 11 ? 'жизнь' : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? 'жизни' : 'жизней';
  return `${n} ${word}`;
}

function metaOf(mode: GameModeDef, difficulty: Difficulty): string {
  const parts: string[] = [];
  if (mode.players === 2) parts.push('2 игрока');
  if (mode.facts) parts.push(mode.facts);
  else if (mode.kind === 'dance') parts.push('72 с · всё тело');
  else if (mode.practice) parts.push('без штрафов');
  else parts.push(lives(livesAt(mode.energy, difficultyOf(supportsDifficulty(mode) ? difficulty : 'normal'))));
  return parts.join(' · ');
}

function unavailable(mode: GameModeDef, profile: Profile): string | null {
  if (!mode.online) return null;
  if (!ONLINE_ENABLED) return 'Онлайн не настроен';
  if (profile.nickname.length < 2) return 'Сначала введи ник';
  return null;
}

/** Camera controls for the menu once the camera is set up: a step (or lean) to the side picks the next mode. */
function MenuGestures({ engine, onStep }: { engine: MotionEngine; onStep: (step: -1 | 1) => void }) {
  const [armedAt] = useState(() => performance.now() + 900);
  useGestureEvents(engine, (event) => {
    if (event.phase !== 'start' || event.timestamp < armedAt) return;
    if (event.type === 'LEAN_LEFT') onStep(-1);
    else if (event.type === 'LEAN_RIGHT') onStep(1);
  });
  return null;
}

interface MenuScreenProps {
  /** The running camera after setup (gestures and the camera tile), or null. */
  engine: MotionEngine | null;
  ready: boolean;
  profile: Profile;
  lastMode: GameModeId;
  /** Room code from an invite link. */
  invite: string | null;
  muted: boolean;
  onToggleMute: () => void;
  onPlay: (mode: GameModeId) => void;
  onTutorial: () => void;
  onLeaderboard: () => void;
  onProfile: (profile: Profile) => void;
}

/**
 * Main menu, laid out like the classic co-op shooter menus: the logo and a column of
 * big items on the left, a panel with the chosen section in the middle, a scene behind.
 * Mouse, touch, keyboard (↑ ↓ ← → Enter, 1–4 for the difficulty) and — once the camera
 * is set up — the body: a step to the side picks a mode, a jump starts it.
 */
export function MenuScreen({ engine, ready, profile, lastMode, invite, muted, onToggleMute, onPlay, onTutorial, onLeaderboard, onProfile }: MenuScreenProps) {
  const items = useMemo(
    () => ITEMS.map((item) => (item.id === 'play' ? { ...item, modes: [...new Set([lastMode, ...HITS])].slice(0, 5) } : item)),
    [lastMode],
  );
  const [active, setActive] = useState<ItemId>(invite ? 'online' : 'play');
  const [picks, setPicks] = useState<Partial<Record<ItemId, GameModeId>>>({});
  /** Phones: the section panel opens as a sheet over the menu. */
  const [sheet, setSheet] = useState(false);
  const [demoMove, setDemoMove] = useState<Move>('LEAN_LEFT');
  const cameraApi = isCameraApiAvailable();
  const item = items.find((i) => i.id === active) ?? (items[0] as MenuItem);
  const modeId = picks[active] ?? item.modes[0] ?? 'classic';
  const mode = getMode(modeId);
  const difficulty = profile.difficulty;
  const blocked = unavailable(mode, profile) ?? (cameraApi ? null : 'Нужен браузер с доступом к камере');
  const live = ready && engine !== null;

  // Menu music: starts now if sound is already unlocked, otherwise on the first click or key.
  const [music] = useState(() => new MenuMusic());
  useEffect(() => {
    let alive = true;
    let timer = 0;
    const begin = () => {
      sfx.unlock();
      // The audio context resumes asynchronously after the unlock; the menu may be gone by then.
      timer = window.setTimeout(() => {
        if (alive) music.start();
      }, 60);
    };
    music.start();
    window.addEventListener('pointerdown', begin, { once: true });
    window.addEventListener('keydown', begin, { once: true });
    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', begin);
      window.removeEventListener('keydown', begin);
      music.stop();
    };
  }, [music]);

  const select = useCallback((id: ItemId) => {
    setActive((prev) => {
      if (prev !== id) sfx.play('step');
      return id;
    });
  }, []);

  const pickMode = useCallback(
    (id: GameModeId) => {
      setPicks((p) => ({ ...p, [active]: id }));
      sfx.play('step');
    },
    [active],
  );

  const stepMode = useCallback(
    (step: -1 | 1) => {
      const list = item.modes;
      if (list.length < 2) return;
      const i = Math.max(0, list.indexOf(modeId));
      const next = list[(i + step + list.length) % list.length];
      if (next) pickMode(next);
    },
    [item, modeId, pickMode],
  );

  const play = useCallback(() => {
    if (blocked) return;
    sfx.unlock();
    sfx.play('confirm');
    onPlay(mode.id);
  }, [blocked, mode, onPlay]);

  const setDifficulty = useCallback(
    (d: Difficulty) => {
      if (d === profile.difficulty) return;
      sfx.play('step');
      onProfile(saveDifficulty(d));
    },
    [onProfile, profile.difficulty],
  );

  const open = useCallback(
    (id: ItemId) => {
      select(id);
      if (id === 'leaderboard') onLeaderboard();
      else if (id === 'tutorial' && cameraApi) onTutorial();
      else {
        setSheet(true);
        window.scrollTo({ top: 0 });
      }
    },
    [cameraApi, onLeaderboard, onTutorial, select],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const index = items.findIndex((i) => i.id === active);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = items[(index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
        if (next) select(next.id);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        stepMode(e.key === 'ArrowLeft' ? -1 : 1);
      } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
        if (item.modes.length > 0) play();
        else if (ACTION_ITEMS.includes(active)) open(active);
      } else if (e.key === 'Escape') {
        setSheet(false);
      } else if (/^[1-4]$/.test(e.key) && supportsDifficulty(mode)) {
        const d = DIFFICULTIES[Number(e.key) - 1];
        if (d) setDifficulty(d.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, item, items, mode, open, play, select, setDifficulty, stepMode]);

  const best = bestFor(profile, mode.id);
  const level = difficultyOf(difficulty);

  return (
    <main className={`screen menu ${sheet ? 'has-sheet' : ''}`}>
      <MenuScene className="menu__scene" />
      <div className="menu__shade" aria-hidden="true" />
      {live && engine && <MenuGestures engine={engine} onStep={stepMode} />}

      <button type="button" className="icon-btn menu__mute" onClick={onToggleMute} aria-label={muted ? 'Включить звук' : 'Выключить звук'} aria-pressed={!muted}>
        <Icon name={muted ? 'mute' : 'sound'} size={20} />
      </button>

      <section className="menu__left">
        <header className="menu__brand">
          <h1 className="menu__logo">
            MOTION<span>//</span>RUSH
          </h1>
          <p className="menu__tagline">Игра, где контроллер — это ты</p>
        </header>

        <nav className="menu__nav" aria-label="Главное меню">
          <ul>
            {items.map((it, i) => (
              <li key={it.id} className={i === 6 ? 'menu__gap' : undefined}>
                <button
                  type="button"
                  className={`menu__item ${it.id === active ? 'is-active' : ''}`}
                  aria-current={it.id === active ? 'true' : undefined}
                  onMouseEnter={() => select(it.id)}
                  onFocus={() => select(it.id)}
                  onClick={() => open(it.id)}
                >
                  <span className="menu__sq" aria-hidden="true" />
                  <span className="menu__item-title">{it.title}</span>
                  {it.modes.length > 1 && it.id !== 'play' && <span className="menu__count">{it.modes.length}</span>}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <footer className="menu__profile">
          {active !== 'online' && <NicknameField value={profile.nickname} onSaved={(nickname) => onProfile({ ...profile, nickname })} compact />}
          {profile.bestScore > 0 && (
            <p className="menu__best">
              Рекорд <strong>{profile.bestScore.toLocaleString('ru-RU')}</strong> · игр {profile.sessions}
            </p>
          )}
        </footer>
      </section>

      <motion.section
        key={active}
        className="menu__panel"
        aria-label={item.title}
        initial={{ opacity: 0.4, x: 14 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <div className="menu__panel-head">
          <button type="button" className="menu__back" onClick={() => setSheet(false)} aria-label="Назад в меню">
            <Icon name="left" size={18} />
          </button>
          <div>
            <p className="t-label">{item.eyebrow}</p>
            <h2 className="menu__panel-title">{item.title}</h2>
          </div>
        </div>

        {item.modes.length > 0 && (
          <>
            <div className="menu__tiles" role="listbox" aria-label="Режимы">
              {item.modes.map((id) => {
                const m = getMode(id);
                const selected = id === mode.id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`menu__tile ${selected ? 'is-selected' : ''}`}
                    style={{ '--accent': m.accent } as CSSProperties}
                    onClick={() => (selected ? play() : pickMode(id))}
                  >
                    <img src={modeArt(id)} alt="" draggable={false} />
                    <span className="menu__tile-icon">
                      <ModeIcon name={m.icon} size={20} />
                    </span>
                    <span className="menu__tile-title">{m.title}</span>
                  </button>
                );
              })}
            </div>

            <div className="menu__detail" style={{ '--accent': mode.accent } as CSSProperties}>
              <div className="menu__detail-head">
                <h3>{mode.title}</h3>
                <span className="menu__badge">{mode.badge}</span>
              </div>
              <p className="menu__tagline-mode">{mode.tagline}</p>
              <p className="menu__meta">
                {metaOf(mode, difficulty)}
                {best > 0 && <strong> · рекорд {best.toLocaleString('ru-RU')}</strong>}
              </p>
              {active === 'online' && (
                <div className="menu__online">
                  {invite && (
                    <p className="menu__invite">
                      Тебя позвали в дуэль: комната <strong>{invite}</strong>
                    </p>
                  )}
                  <NicknameField value={profile.nickname} onSaved={(nickname) => onProfile({ ...profile, nickname })} />
                </div>
              )}
            </div>

            <div className="menu__difficulty">
              <p className="t-label">Сложность</p>
              {supportsDifficulty(mode) ? (
                <>
                  <div className="menu__levels" role="radiogroup" aria-label="Сложность">
                    {DIFFICULTIES.map((d, i) => (
                      <button
                        key={d.id}
                        type="button"
                        role="radio"
                        aria-checked={d.id === difficulty}
                        className={`menu__level ${d.id === difficulty ? 'is-on' : ''}`}
                        data-level={i + 1}
                        onClick={() => setDifficulty(d.id)}
                      >
                        <span className="menu__bars" aria-hidden="true">
                          {DIFFICULTIES.map((_, k) => (
                            <i key={k} className={k <= i ? 'is-lit' : undefined} />
                          ))}
                        </span>
                        {d.title}
                      </button>
                    ))}
                  </div>
                  <p className="menu__level-hint">{level.hint}</p>
                </>
              ) : (
                <p className="menu__level-hint">{fixedLevelNote(mode)}</p>
              )}
            </div>

            <div className="menu__start">
              {blocked ? (
                <p className="menu__blocked">{blocked}</p>
              ) : live && engine ? (
                <HoldGesture key={mode.id} engine={engine} label={`Играть: ${mode.title}`} onConfirm={play} />
              ) : (
                <button type="button" className="menu__play" onClick={play}>
                  <span>Играть</span>
                  <Icon name="right" size={22} />
                </button>
              )}
              <p className="menu__keys">
                {live ? 'Шаг влево / вправо — выбор режима · прыжок — старт' : ready ? 'Enter — старт' : 'Камера включится после нажатия — настройка около 30 секунд'}
              </p>
            </div>
          </>
        )}

        {active === 'leaderboard' && (
          <div className="menu__info">
            <p>Лучшие результаты игроков по каждому режиму — общий рейтинг в интернете и твои рекорды на этом устройстве.</p>
            <button type="button" className="menu__play" onClick={onLeaderboard}>
              <span>Открыть рейтинг</span>
              <Icon name="right" size={22} />
            </button>
          </div>
        )}

        {active === 'tutorial' && (
          <div className="menu__info">
            <ul className="menu__moves">
              {MOVES.map((m) => {
                const meta = BODY_MOTION_META[m];
                return (
                  <li key={m} className={m === demoMove ? 'is-active' : undefined}>
                    <span className="menu__move-icon">{meta.arrow && <Icon name={meta.arrow} size={18} />}</span>
                    <strong>{meta.title}</strong>
                    <span>{meta.action}</span>
                  </li>
                );
              })}
            </ul>
            <button type="button" className="menu__play" onClick={onTutorial} disabled={!cameraApi}>
              <span>Пройти обучение</span>
              <Icon name="right" size={22} />
            </button>
          </div>
        )}

        {active === 'about' && (
          <div className="menu__info">
            <ol className="menu__how">
              {HOW_TO.map((step, i) => (
                <li key={step.title}>
                  <span className="menu__how-num">{i + 1}</span>
                  <strong>{step.title}</strong>
                  <span>{step.text}</span>
                </li>
              ))}
            </ol>
            <ul className="menu__stats">
              {STATS.map((s) => (
                <li key={s.label}>
                  <strong>{s.value}</strong>
                  <span>{s.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </motion.section>

      <aside className="menu__hero" aria-hidden={!live}>
        {live && engine ? (
          <div className="menu__cam">
            <CameraViewport engine={engine} variant="pip" hud={false} className="menu__camera" />
            <span className="t-label">Камера включена — играй телом</span>
          </div>
        ) : (
          <DemoFigure move="cycle" className="menu__figure" onMoveChange={setDemoMove} label="Фигура показывает движения игры" />
        )}
      </aside>

      <p className="menu__privacy">
        <Icon name="camera" size={14} /> Распознавание прямо в браузере — видео не уходит в сеть
      </p>
      {!cameraApi && (
        <p className="menu__warning" role="alert">
          Этот браузер не даёт доступ к камере. Открой сайт в Chrome, Edge, Safari или Firefox по https.
        </p>
      )}
    </main>
  );
}
