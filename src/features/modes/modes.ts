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
  | 'duel';

export interface GameModeDef {
  id: GameModeId;
  /** runner = obstacle course; dance = dance floor (match poses to the beat). */
  kind: 'runner' | 'dance';
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
}

const RUNNER = { kind: 'runner', players: 1, practice: false, seed: 'random', ranked: true, online: false } as const;

const ALL_MODES: readonly GameModeDef[] = [
  {
    ...RUNNER,
    id: 'classic',
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
    kind: 'dance',
    title: 'Dance Floor',
    badge: 'НОВОЕ',
    tagline: 'Танцпол: повторяй позы в такт музыке — чем точнее, тем больше очков',
    accent: '#ff5ad1',
    course: 'standard',
    energy: GAME_CONFIG.energy,
    goal: 'Попадай в ритм',
  },
  {
    ...RUNNER,
    id: 'dance-duo',
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
    players: 2,
    title: 'Versus 2P',
    badge: '2 ИГРОКА',
    tagline: 'Двое у одного ноутбука: у каждого своя трасса — кто наберёт больше',
    accent: '#2ee6ff',
    course: 'standard',
    energy: GAME_CONFIG.energy,
    ranked: false,
    goal: 'Обгони друга',
  },
  {
    ...RUNNER,
    id: 'endless',
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
    title: 'Lane Rush',
    badge: 'ДВИЖЕНИЕ',
    tagline: 'Только ворота: перебегай между полосами влево-вправо',
    accent: '#b4ff3d',
    course: 'lanes',
    energy: GAME_CONFIG.energy,
    goal: 'Меняй полосы',
  },
  {
    ...RUNNER,
    id: 'hardcore',
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
  return { mode: mode.id, scheme, energy: mode.energy, practice: mode.practice };
}
