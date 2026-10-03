import { COURSES, GAME_CONFIG, type CourseKind } from '../../config/game.config';
import { dailySeed, generateCourse } from '../gameplay/course';
import type { GameRules } from '../gameplay/GameEngine';
import type { CourseItem } from '../gameplay/types';
import type { ControlScheme } from '../gestures/types';

export type GameModeId =
  | 'classic'
  | 'endless'
  | 'sprint'
  | 'blitz'
  | 'daily'
  | 'hardcore'
  | 'jumpduck'
  | 'lanes'
  | 'practice'
  | 'dance'
  | 'dance-duo'
  | 'versus'
  | 'duel'
  | 'stars'
  | 'freeze'
  | 'reaction'
  | 'squats';

/** Groups for the mode picker. */
export type ModeCategory = 'run' | 'arcade' | 'dance' | 'duo' | 'online';

export const MODE_CATEGORIES: { id: ModeCategory; title: string }[] = [
  { id: 'run', title: 'Бег' },
  { id: 'arcade', title: 'Мини-игры' },
  { id: 'dance', title: 'Танцы' },
  { id: 'duo', title: 'Вдвоём' },
  { id: 'online', title: 'Онлайн' },
];

/** Arcade mini-games (see features/arcade). */
export type ArcadeKind = 'stars' | 'freeze' | 'reaction' | 'squats';

export type ModeIconName =
  | 'run'
  | 'infinity'
  | 'bolt'
  | 'stopwatch'
  | 'calendar'
  | 'updown'
  | 'lanes'
  | 'heart'
  | 'target'
  | 'note'
  | 'notes'
  | 'duo'
  | 'globe'
  | 'star'
  | 'freeze'
  | 'reflex'
  | 'squat';

export interface GameModeDef {
  id: GameModeId;
  category: ModeCategory;
  /** Pictogram on the mode card. */
  icon: ModeIconName;
  /** runner = obstacle course; dance = dance floor (match poses to the beat); arcade = a mini-game. */
  kind: 'runner' | 'dance' | 'arcade';
  /** Which mini-game (kind = arcade). */
  arcade?: ArcadeKind;
  /** Short facts for the card instead of lives ("60 с · руки"). */
  facts?: string;
  /** 2 = two players in front of one camera (left / right half of the frame). */
  players: 1 | 2;
  /** Display title (EN, short, like the rest of the HUD). */
  title: string;
  /** Small label on the card. */
  badge: string;
  /** One line in Russian: what makes this mode different. */
  tagline: string;
  /** Accent colour for the card and HUD. */
  accent: string;
  course: CourseKind;
  energy: number;
  practice: boolean;
  /** random = a new course every run; daily = same for everyone today; shared = set by the online room. */
  seed: 'random' | 'daily' | 'shared';
  /** Scores go to the leaderboard. */
  ranked: boolean;
  /** Needs the online backend. */
  online: boolean;
  /** Label for the progress bar area. */
  goal: string;
  /** Wider timing windows for this mode (see GameRules.timing). */
  timing?: GameRules['timing'];
}

/**
 * Two players at one camera: each tracker sees ~5 frames a second, so a move
 * registers 0.3–0.5 s later than in single play. The windows grow by about
 * that much: a longer flight and more time to be in place after arrival.
 */
const DUO_TIMING: GameRules['timing'] = { airtimeMs: 900, clearGraceMs: 450, duckGraceMs: 320 };
/** A busy laptop (e.g. a video call running next to the game): a bit more time. */
const BUSY_TIMING: GameRules['timing'] = { airtimeMs: 800, clearGraceMs: 320, duckGraceMs: 270 };

/**
 * Timing windows for how fast this device recognises poses (results per
 * second, measured before the run). Slow recognition registers every move
 * later, so the windows grow by about that delay; a fast device keeps the
 * standard ones. 0 = not measured yet.
 */
export function timingForRecognition(hz: number): GameRules['timing'] | undefined {
  if (hz <= 0 || hz >= 13) return undefined;
  return hz < 8 ? DUO_TIMING : BUSY_TIMING;
}

const RUNNER = { kind: 'runner', players: 1, practice: false, seed: 'random', ranked: true, online: false } as const;
/**
 * Mini-games keep records on this device only: the global leaderboard table
 * accepts the runner and dance modes (see supabase/schema.sql).
 */
const ARCADE = {
  kind: 'arcade',
  category: 'arcade',
  players: 1,
  practice: false,
  seed: 'random',
  ranked: false,
  online: false,
  course: 'standard',
  energy: GAME_CONFIG.energy,
} as const;

const ALL_MODES: readonly GameModeDef[] = [
  {
    ...RUNNER,
    id: 'classic',
    category: 'run',
    icon: 'run',
    title: 'Classic Run',
    badge: 'НАЧНИ ОТСЮДА',
    tagline: '70 секунд, 4 фазы скорости, каждый раз новая трасса',
    accent: '#2ee6ff',
    course: 'standard',
    energy: GAME_CONFIG.energy,
    goal: 'Дойди до финиша',
  },
  {
    ...RUNNER,
    id: 'dance',
    category: 'dance',
    icon: 'note',
    kind: 'dance',
    title: 'Dance Floor',
    badge: 'НОВОЕ',
    tagline: 'Танцпол всем телом: позы рук, приседы, прыжки и шаги в такт музыке',
    accent: '#ff5ad1',
    course: 'standard',
    energy: GAME_CONFIG.energy,
    goal: 'Попадай в ритм',
  },
  {
    ...ARCADE,
    id: 'stars',
    icon: 'star',
    arcade: 'stars',
    title: 'Star Catch',
    badge: 'РУКИ',
    tagline: 'Звёзды вспыхивают вокруг тебя — лови их руками, пока не погасли, и не задень бомбы',
    accent: '#ffd24d',
    goal: 'Лови звёзды',
    facts: '60 с · 3 жизни',
  },
  {
    ...ARCADE,
    id: 'freeze',
    icon: 'freeze',
    arcade: 'freeze',
    title: 'Freeze!',
    badge: 'ЗАМРИ',
    tagline: '«Море волнуется»: на зелёный беги, на красный замри в загаданной фигуре',
    accent: '#3dffb0',
    goal: 'Добеги до финиша',
    facts: '100 м · 3 жизни',
  },
  {
    ...RUNNER,
    id: 'dance-duo',
    category: 'duo',
    icon: 'notes',
    kind: 'dance',
    players: 2,
    title: 'Dance Battle',
    badge: '2 ИГРОКА',
    tagline: 'Двое у одной камеры: левый и правый танцуют одну хореографию — кто точнее',
    accent: '#ffc14d',
    course: 'standard',
    energy: GAME_CONFIG.energy,
    ranked: false,
    goal: 'Перетанцуй соседа',
  },
  {
    ...RUNNER,
    id: 'versus',
    category: 'duo',
    icon: 'duo',
    players: 2,
    title: 'Versus 2P',
    badge: '2 ИГРОКА',
    tagline: 'Двое у одного ноутбука: у каждого своя трасса — кто наберёт больше',
    accent: '#2ee6ff',
    course: 'duo',
    energy: GAME_CONFIG.energy,
    ranked: false,
    goal: 'Обгони друга',
    timing: DUO_TIMING,
  },
  {
    ...RUNNER,
    id: 'endless',
    category: 'run',
    icon: 'infinity',
    title: 'Endless',
    badge: 'ВЫЖИВАНИЕ',
    tagline: 'Скорость растёт бесконечно — продержись как можно дольше',
    accent: '#8b5cff',
    course: 'endless',
    energy: 3,
    goal: 'Выживи',
  },
  {
    ...RUNNER,
    id: 'blitz',
    category: 'run',
    icon: 'bolt',
    title: 'Blitz',
    badge: 'СКОРОСТЬ',
    tagline: '45 секунд на максимальной скорости с первой секунды',
    accent: '#ff8a3d',
    course: 'blitz',
    energy: 3,
    goal: 'Не сбавляй',
  },
  {
    ...RUNNER,
    id: 'sprint',
    category: 'run',
    icon: 'stopwatch',
    title: 'Sprint 30',
    badge: 'КОРОТКИЙ',
    tagline: '30 секунд без разгона — максимум очков',
    accent: '#ffc14d',
    course: 'sprint',
    energy: GAME_CONFIG.energy,
    goal: 'Набери максимум',
  },
  {
    ...RUNNER,
    id: 'daily',
    category: 'run',
    icon: 'calendar',
    title: 'Daily Challenge',
    badge: 'ДЕНЬ',
    tagline: 'Новая трасса каждый день — одна для всех игроков',
    accent: '#3dffb0',
    course: 'standard',
    energy: GAME_CONFIG.energy,
    seed: 'daily',
    goal: 'Трасса дня',
  },
  {
    ...RUNNER,
    id: 'jumpduck',
    category: 'run',
    icon: 'updown',
    title: 'Jump & Squat',
    badge: 'ТРЕНИРОВКА НОГ',
    tagline: 'Только барьеры и лучи: прыжки и приседания без остановки',
    accent: '#5ab0ff',
    course: 'vertical',
    energy: GAME_CONFIG.energy,
    goal: 'Прыгай и приседай',
  },
  {
    ...RUNNER,
    id: 'lanes',
    category: 'run',
    icon: 'lanes',
    title: 'Lane Rush',
    badge: 'ДВИЖЕНИЕ',
    tagline: 'Только ворота: перебегай между полосами влево-вправо',
    accent: '#b4ff3d',
    course: 'lanes',
    energy: GAME_CONFIG.energy,
    goal: 'Меняй полосы',
  },
  {
    ...ARCADE,
    id: 'reaction',
    icon: 'reflex',
    arcade: 'reaction',
    title: 'Reaction',
    badge: 'РЕАКЦИЯ',
    tagline: 'Жди сигнала и сделай показанное движение быстрее всех — время в миллисекундах',
    accent: '#5ab0ff',
    goal: 'Быстрее',
    facts: '10 раундов',
  },
  {
    ...ARCADE,
    id: 'squats',
    icon: 'squat',
    arcade: 'squats',
    title: 'Squat 30',
    badge: 'ЧЕЛЛЕНДЖ',
    tagline: 'Сколько полных приседаний успеешь за 30 секунд? Игра следит за глубиной',
    accent: '#ff8a3d',
    goal: 'Приседай',
    facts: '30 с',
  },
  {
    ...RUNNER,
    id: 'hardcore',
    category: 'run',
    icon: 'heart',
    title: 'Hardcore',
    badge: 'ЭКСПЕРТ',
    tagline: 'Одна жизнь. Одна ошибка — и всё',
    accent: '#ff5a3d',
    course: 'standard',
    energy: 1,
    goal: 'Без ошибок',
  },
  {
    ...RUNNER,
    id: 'practice',
    category: 'run',
    icon: 'target',
    title: 'Practice',
    badge: 'ОБУЧЕНИЕ',
    tagline: 'Медленно и без штрафов — учись движениям с подсказками',
    accent: '#a4aac2',
    course: 'practice',
    energy: GAME_CONFIG.energy,
    practice: true,
    ranked: false,
    goal: 'Тренировка',
  },
  {
    ...RUNNER,
    id: 'duel',
    category: 'online',
    icon: 'globe',
    title: 'Online Duel',
    badge: 'ОНЛАЙН',
    tagline: 'Гонка 1 на 1 по сети: одна трасса, кто наберёт больше',
    accent: '#ff5ad1',
    course: 'standard',
    energy: GAME_CONFIG.energy,
    seed: 'shared',
    ranked: false,
    online: true,
    goal: 'Обгони соперника',
  },
];

/** Modes shown in the menu. */
export const GAME_MODES: readonly GameModeDef[] = ALL_MODES;

export function getMode(id: string): GameModeDef {
  return ALL_MODES.find((m) => m.id === id) ?? (ALL_MODES[0] as GameModeDef);
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

/** Seed of the course for one run: random every time, the day's seed, or the online room's. */
export function seedForMode(mode: GameModeDef, sharedSeed?: number): number {
  if (mode.seed === 'daily') return dailySeed();
  if (mode.seed === 'shared' && sharedSeed !== undefined) return sharedSeed;
  return randomSeed();
}

export function courseForMode(mode: GameModeDef, sharedSeed?: number): CourseItem[] {
  return generateCourse(seedForMode(mode, sharedSeed), COURSES[mode.course]);
}

export function rulesForMode(mode: GameModeDef, scheme: ControlScheme): GameRules {
  return { mode: mode.id, scheme, energy: mode.energy, practice: mode.practice, timing: mode.timing };
}
