import { COURSES, GAME_CONFIG, type CourseKind } from '../../config/game.config';
import { dailySeed, generateCourse } from '../gameplay/course';
import type { GameRules } from '../gameplay/GameEngine';
import type { CourseItem } from '../gameplay/types';
import type { ControlScheme } from '../gestures/types';

export type GameModeId = 'classic' | 'endless' | 'sprint' | 'hardcore' | 'practice' | 'daily' | 'duel';

export interface GameModeDef {
  id: GameModeId;
  /** Display title (EN, short, like the rest of the HUD). */
  title: string;
  /** One line in Russian: what makes this mode different. */
  tagline: string;
  /** Accent colour for the card and HUD. */
  accent: string;
  course: CourseKind;
  energy: number;
  practice: boolean;
  /** fixed = same course every run; daily = same for everyone today; shared = set by the online room. */
  seed: 'fixed' | 'daily' | 'shared';
  /** Scores go to the leaderboard. */
  ranked: boolean;
  /** Needs the online backend. */
  online: boolean;
  /** Label for the progress bar area. */
  goal: string;
}

export const GAME_MODES: readonly GameModeDef[] = [
  {
    id: 'classic',
    title: 'Classic Run',
    tagline: '70 секунд, 4 фазы сложности, 5 жизней',
    accent: '#2ee6ff',
    course: 'standard',
    energy: GAME_CONFIG.energy,
    practice: false,
    seed: 'fixed',
    ranked: true,
    online: false,
    goal: 'Дойди до финиша',
  },
  {
    id: 'endless',
    title: 'Endless',
    tagline: 'Скорость растёт бесконечно — продержись как можно дольше',
    accent: '#8b5cff',
    course: 'endless',
    energy: 3,
    practice: false,
    seed: 'fixed',
    ranked: true,
    online: false,
    goal: 'Выживи',
  },
  {
    id: 'sprint',
    title: 'Sprint 30',
    tagline: '30 секунд без разгона — максимум очков',
    accent: '#ffc14d',
    course: 'sprint',
    energy: GAME_CONFIG.energy,
    practice: false,
    seed: 'fixed',
    ranked: true,
    online: false,
    goal: 'Набери максимум',
  },
  {
    id: 'daily',
    title: 'Daily Challenge',
    tagline: 'Новая трасса каждый день — одна для всех игроков',
    accent: '#3dffb0',
    course: 'standard',
    energy: GAME_CONFIG.energy,
    practice: false,
    seed: 'daily',
    ranked: true,
    online: false,
    goal: 'Трасса дня',
  },
  {
    id: 'hardcore',
    title: 'Hardcore',
    tagline: 'Одна жизнь. Одна ошибка — и всё',
    accent: '#ff5a3d',
    course: 'standard',
    energy: 1,
    practice: false,
    seed: 'fixed',
    ranked: true,
    online: false,
    goal: 'Без ошибок',
  },
  {
    id: 'practice',
    title: 'Practice',
    tagline: 'Медленно и без штрафов — учись движениям с подсказками',
    accent: '#a4aac2',
    course: 'practice',
    energy: GAME_CONFIG.energy,
    practice: true,
    seed: 'fixed',
    ranked: false,
    online: false,
    goal: 'Тренировка',
  },
  {
    id: 'duel',
    title: 'Online Duel',
    tagline: 'Гонка 1 на 1 по сети: одна трасса, кто наберёт больше',
    accent: '#ff5ad1',
    course: 'standard',
    energy: GAME_CONFIG.energy,
    practice: false,
    seed: 'shared',
    ranked: false,
    online: true,
    goal: 'Обгони соперника',
  },
];

export function getMode(id: string): GameModeDef {
  return GAME_MODES.find((m) => m.id === id) ?? (GAME_MODES[0] as GameModeDef);
}

/** Builds the course for a mode. `sharedSeed` comes from an online room. */
export function courseForMode(mode: GameModeDef, sharedSeed?: number): CourseItem[] {
  const seed = mode.seed === 'daily' ? dailySeed() : mode.seed === 'shared' && sharedSeed !== undefined ? sharedSeed : GAME_CONFIG.seed;
  return generateCourse(seed, COURSES[mode.course]);
}

export function rulesForMode(mode: GameModeDef, scheme: ControlScheme): GameRules {
  return { mode: mode.id, scheme, energy: mode.energy, practice: mode.practice };
}
