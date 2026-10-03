import type { CourseConfig } from '../../config/game.config';
import type { GameRules } from '../gameplay/GameEngine';

/** Four levels, like the classic co-op shooters: from a calm first try to a real test. */
export type Difficulty = 'easy' | 'normal' | 'hard' | 'expert';

export interface DifficultyDef {
  id: Difficulty;
  title: string;
  /** One line for the menu: what changes. */
  hint: string;
  /** Points are worth this much: harder = more points, so records stay comparable. */
  score: number;
  /** Runner: spacing between obstacles and how long one is visible (less = faster). */
  gap: number;
  lead: number;
  /** Runner: lives added to the mode's own (never below one). */
  lives: number;
  /** Runner: timing windows (how late a move may come). Only easier levels widen them. */
  window: number;
  /** Dance floor: judging window and pose tolerance (more = forgiving). */
  danceWindow: number;
  danceTolerance: number;
  /** Mini-games: how fast things happen and how long they last (more = faster). */
  pace: number;
}

export const DIFFICULTIES: readonly DifficultyDef[] = [
  {
    id: 'easy',
    title: 'Лёгкий',
    hint: 'медленнее, больше жизней и времени на движение',
    score: 0.8,
    gap: 1.25,
    lead: 1.2,
    lives: 2,
    window: 1.4,
    danceWindow: 1.4,
    danceTolerance: 1.3,
    pace: 0.8,
  },
  {
    id: 'normal',
    title: 'Обычный',
    hint: 'как задумано',
    score: 1,
    gap: 1,
    lead: 1,
    lives: 0,
    window: 1,
    danceWindow: 1,
    danceTolerance: 1,
    pace: 1,
  },
  {
    id: 'hard',
    title: 'Сложный',
    hint: 'быстрее и плотнее, на жизнь меньше · очки ×1,25',
    score: 1.25,
    gap: 0.86,
    lead: 0.86,
    lives: -1,
    window: 1,
    danceWindow: 0.85,
    danceTolerance: 0.88,
    pace: 1.15,
  },
  {
    id: 'expert',
    title: 'Эксперт',
    hint: 'максимальная скорость, две жизни долой · очки ×1,5',
    score: 1.5,
    gap: 0.75,
    lead: 0.76,
    lives: -2,
    window: 1,
    danceWindow: 0.72,
    danceTolerance: 0.78,
    pace: 1.3,
  },
];

export const DEFAULT_DIFFICULTY: Difficulty = 'normal';

export function isDifficulty(value: unknown): value is Difficulty {
  return DIFFICULTIES.some((d) => d.id === value);
}

export function difficultyOf(id: Difficulty): DifficultyDef {
  return DIFFICULTIES.find((d) => d.id === id) ?? (DIFFICULTIES[1] as DifficultyDef);
}

/** A runner course at this difficulty: obstacles closer together and faster (or calmer). */
export function scaleCourse(cfg: CourseConfig, d: DifficultyDef): CourseConfig {
  if (d.gap === 1 && d.lead === 1) return cfg;
  return {
    ...cfg,
    crossoverPenaltyMs: Math.round(cfg.crossoverPenaltyMs * Math.max(d.gap, 0.85)),
    phases: cfg.phases.map((p) => ({
      ...p,
      gapMs: [Math.round(p.gapMs[0] * d.gap), Math.round(p.gapMs[1] * d.gap)] as const,
      leadMs: Math.round(p.leadMs * d.lead),
    })),
  };
}

/** Dance floor: judging window, pose tolerance and the point value. */
export function danceTune(d: DifficultyDef): { window: number; tolerance: number; score: number } {
  return { window: d.danceWindow, tolerance: d.danceTolerance, score: d.score };
}

/** Mini-games: the pace, one life more on Easy and one less on Expert, and the point value. */
export function arcadeTune(d: DifficultyDef): { pace: number; lives: number; score: number } {
  return { pace: d.pace, lives: d.id === 'easy' ? 1 : d.id === 'expert' ? -1 : 0, score: d.score };
}

/** Lives at this difficulty: one-life modes stay one life. */
export function livesAt(energy: number, d: DifficultyDef): number {
  if (energy <= 1) return energy;
  return Math.max(1, energy + d.lives);
}

/** Wider windows on easier levels; never narrower than the mode's own. */
export function timingAt(base: Required<NonNullable<GameRules['timing']>>, d: DifficultyDef): NonNullable<GameRules['timing']> {
  const w = Math.max(1, d.window);
  return {
    airtimeMs: Math.round(base.airtimeMs * (1 + (w - 1) * 0.35)),
    clearGraceMs: Math.round(base.clearGraceMs * w),
    duckGraceMs: Math.round(base.duckGraceMs * w),
  };
}
