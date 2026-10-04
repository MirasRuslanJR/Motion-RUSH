import type { SfxName } from '../../lib/audio/sfx';
import type { Point } from '../../lib/math/geometry';
import type { Baseline } from '../gestures/calibration';
import type { ExpectedMotion, GestureEvent, GestureType } from '../gestures/types';
import { LM, lm, type Pose } from '../tracking/landmarks';

/**
 * Arcade mini-games: short rounds with their own mechanics (catch stars with
 * your hands, freeze on red, react to a cue, squat count) on top of the same
 * recognition pipeline. Game logic here is pure; drawing lives in the renderer.
 */

/** What a mini-game reads from the camera every display frame. */
export interface ArcadeInput {
  /** Smoothed pose in frame units (mirrored), null when the player is not tracked. */
  pose: Pose | null;
  baseline: Baseline | null;
  /** Frame width / height. */
  aspect: number;
  /** A new recognition result arrived this frame. */
  inferred: boolean;
  /** Gesture starts and ends since the previous frame. */
  events: readonly GestureEvent[];
  /** Gestures confirmed right now. */
  lateral: GestureType | null;
  vertical: GestureType | null;
  /** Error-mode hint for the move the game expects (see ArcadeGame.expected). */
  hint: string | null;
}

export type Tone = 'go' | 'stop' | 'warn' | 'info' | 'good' | 'bad';

/** Low-frequency state for the screen (changes a few times a second). */
export interface ArcadeHud {
  /** The main number, top left: points, distance, average time… */
  stat: { label: string; value: string };
  /** Top-right counter: time left, round, time elapsed… */
  counter: string;
  lives: number | null;
  /** 0..1 — time or distance, null = no bar. */
  progress: number | null;
  /** Current series (shown from 3 up). */
  combo: number;
  /** Big line in the middle: what to do right now. */
  cue: { text: string; tone: Tone; sub?: string } | null;
  /** A short message after an event; a new id restarts its animation. */
  toast: { id: number; text: string; tone: Tone } | null;
  /** Live gauge 0..1 (e.g. how still the player is) with an optional limit mark; null = hidden. */
  meter: { value: number; mark: number | null; label: string; danger: boolean } | null;
  /** Freeze!: the figure called for the red light (arm angles as on the dance floor). */
  figure?: { name: string; left: number; right: number; state: 'soon' | 'now' | 'hit' } | null;
  /** A race to the finish: a runner rides the progress bar. */
  runner?: boolean;
  /** Boss fight: the boss's health. */
  boss?: { hp: number; max: number; stunned: boolean } | null;
}

export interface ArcadeResult {
  score: number;
  /** Big value on the result card ("452 мс", "17"). */
  headline: string;
  caption: string;
  lines: string[];
  /** 0..1 */
  accuracy: number;
  bestCombo: number;
}

export interface ArcadeGame {
  /** Advance one display frame; returns the sounds to play. */
  update(input: ArcadeInput, dtMs: number, now: number): SfxName[];
  hud(): ArcadeHud;
  readonly done: boolean;
  result(): ArcadeResult;
  /** The move the engine should diagnose (error mode), or null. */
  readonly expected: ExpectedMotion | null;
}

/** Difficulty of a mini-game: pace (more = faster), lives added and what a point is worth. */
export interface ArcadeTune {
  pace: number;
  lives: number;
  score: number;
}

export const NORMAL_TUNE: ArcadeTune = { pace: 1, lives: 0, score: 1 };

/** Shoulder centre and width of a pose (frame units), null when the shoulders are not visible. */
export function bodyOf(pose: Pose): { center: Point; sw: number } | null {
  const ls = lm(pose, LM.LEFT_SHOULDER);
  const rs = lm(pose, LM.RIGHT_SHOULDER);
  if (Math.min(ls.v, rs.v) < 0.5) return null;
  const sw = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  return sw > 0 ? { center: { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 }, sw } : null;
}

/** "0:42" */
export function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Linear interpolation between a range's ends. */
export function lerpRange(range: readonly [number, number], k: number): number {
  return range[0] + (range[1] - range[0]) * Math.min(1, Math.max(0, k));
}
