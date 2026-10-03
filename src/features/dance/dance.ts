import { clamp } from '../../lib/math/geometry';
import { LM, lm, type Pose } from '../tracking/landmarks';

/**
 * Dance Floor — match the shown move on the beat.
 *
 * A move is the direction of each arm, measured at the shoulder:
 *   0° = arm straight down, 90° = straight out to the side, 180° = straight up
 *   (negative = crossing in front of the body). Mirrored frame: the player's
 *   left arm is on the left of the screen, so the numbers read like a mirror.
 * Whole-body moves add a squat, a jump or a step to the side on top of the arms.
 */
export type DanceBody = 'squat' | 'jump' | 'step-left' | 'step-right';

export interface DancePose {
  id: string;
  /** Short Russian name shown on the card. */
  title: string;
  left: number;
  right: number;
  /** Whole-body part of the move; arms-only poses have none. */
  body?: DanceBody;
}

export const DANCE_POSES: readonly DancePose[] = [
  { id: 'V', title: 'Руки вверх', left: 155, right: 155 },
  { id: 'T', title: 'Самолёт', left: 90, right: 90 },
  { id: 'L_UP', title: 'Левая вверх', left: 170, right: 15 },
  { id: 'R_UP', title: 'Правая вверх', left: 15, right: 170 },
  { id: 'DISCO_L', title: 'Диско ↖', left: 140, right: 35 },
  { id: 'DISCO_R', title: 'Диско ↗', left: 35, right: 140 },
  { id: 'LOW_V', title: 'Руки вниз-в стороны', left: 45, right: 45 },
  { id: 'L_OUT', title: 'Левая в сторону', left: 90, right: 15 },
  { id: 'R_OUT', title: 'Правая в сторону', left: 15, right: 90 },
  { id: 'Y_L', title: 'Левая вверх, правая в сторону', left: 165, right: 90 },
  { id: 'Y_R', title: 'Правая вверх, левая в сторону', left: 90, right: 165 },
  { id: 'SQUAT_T', title: 'Присед, руки в стороны', left: 90, right: 90, body: 'squat' },
  { id: 'SQUAT_LOW', title: 'Пружинка — присед', left: 40, right: 40, body: 'squat' },
  { id: 'JUMP_V', title: 'Прыжок, руки вверх', left: 160, right: 160, body: 'jump' },
  { id: 'STAR', title: 'Звезда — прыжок', left: 125, right: 125, body: 'jump' },
  { id: 'STEP_L', title: 'Шаг влево, левая вверх', left: 165, right: 20, body: 'step-left' },
  { id: 'STEP_R', title: 'Шаг вправо, правая вверх', left: 20, right: 165, body: 'step-right' },
  { id: 'STEP_L_DISCO', title: 'Шаг влево, диско', left: 140, right: 35, body: 'step-left' },
  { id: 'STEP_R_DISCO', title: 'Шаг вправо, диско', left: 35, right: 140, body: 'step-right' },
];

export const DANCE_CONFIG = {
  bpm: 120,
  /** Beats in the song (72 s at 120 bpm); its parts and moves are in choreography.ts. */
  beats: 144,
  /** A card is visible this long before its beat. */
  leadMs: 3000,
  /** The pose is judged by the best match inside [beat - early, beat + late]. */
  earlyMs: 250,
  lateMs: 300,
  perfect: 0.82,
  good: 0.55,
  /** Per-arm error (deg) that still counts as exact, and where the match drops to zero. */
  exactDeg: 20,
  zeroDeg: 62,
  /**
   * Whole-body moves: how far the shoulders move from where the dancer stands, in shoulder
   * widths (full credit at the first number, none below the `…From` one). Shoulders are seen
   * even when only the upper body is in the picture, so this works for two dancers too.
   */
  body: {
    squat: 0.35,
    squatFrom: 0.12,
    jump: 0.2,
    jumpFrom: 0.07,
    step: 0.5,
    stepFrom: 0.18,
    /** How fast the standing spot follows a dancer who drifts around between body moves (ms). */
    followMs: 2500,
  },
  points: { perfect: 300, good: 150 },
  comboPerMultiplier: 6,
  maxMultiplier: 4,
} as const;

export const BEAT_MS = 60000 / DANCE_CONFIG.bpm;

export interface ArmAngles {
  left: number;
  right: number;
  /** Both arms clearly visible. */
  visible: boolean;
}

/** Where the shoulders are relative to the dancer's standing spot, in shoulder widths: +x = to the right of the screen, +y = lower. */
export interface BodyOffset {
  x: number;
  y: number;
}

/** What the dance floor judges for one dancer: the arms and, for whole-body moves, the body. */
export interface DanceInput extends ArmAngles {
  body?: BodyOffset | null;
}

function armAngle(pose: Pose, shoulder: number, elbow: number, wrist: number, outward: -1 | 1): { deg: number; visible: boolean } {
  const s = lm(pose, shoulder);
  const w = lm(pose, wrist);
  const e = lm(pose, elbow);
  // A wrist out of the frame (hands up close to the camera): use the elbow direction.
  const end = w.v >= 0.4 ? w : e;
  const dx = (end.x - s.x) * outward;
  const dy = end.y - s.y;
  return { deg: (Math.atan2(dx, dy) * 180) / Math.PI, visible: Math.min(s.v, end.v) >= 0.4 };
}

export function armAngles(pose: Pose): ArmAngles {
  const l = armAngle(pose, LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST, -1);
  const r = armAngle(pose, LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST, 1);
  return { left: l.deg, right: r.deg, visible: l.visible && r.visible };
}

export function angleDiff(a: number, b: number): number {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

/** A tolerance above 1 forgives more (easier levels), below 1 asks for a cleaner pose. */
function armScore(actual: number, target: number, tolerance = 1): number {
  const exact = DANCE_CONFIG.exactDeg * tolerance;
  const zero = DANCE_CONFIG.zeroDeg * tolerance;
  return clamp(1 - (angleDiff(actual, target) - exact) / (zero - exact), 0, 1);
}

function ramp(value: number, from: number, full: number): number {
  return clamp((value - from) / (full - from), 0, 1);
}

/** 0..1: how far the body went into a squat, a jump or a step. */
export function bodyScore(body: DanceBody, offset: BodyOffset | null | undefined, tolerance = 1): number {
  if (!offset) return 0;
  const c = DANCE_CONFIG.body;
  const k = 1 / tolerance;
  switch (body) {
    case 'squat':
      return ramp(offset.y, c.squatFrom * k, c.squat * k);
    case 'jump':
      return ramp(-offset.y, c.jumpFrom * k, c.jump * k);
    case 'step-left':
      return ramp(-offset.x, c.stepFrom * k, c.step * k);
    case 'step-right':
      return ramp(offset.x, c.stepFrom * k, c.step * k);
  }
}

/** 0..1: how well the dancer matches the move. A whole-body move is half arms, half body. */
export function poseMatch(input: DanceInput, pose: DancePose, tolerance = 1): number {
  const arms = (armScore(input.left, pose.left, tolerance) + armScore(input.right, pose.right, tolerance)) / 2;
  return pose.body ? (arms + bodyScore(pose.body, input.body, tolerance)) / 2 : arms;
}

/** What the body still has to do for the move, or null when it is done. */
function bodyFix(body: DanceBody, offset: BodyOffset | null | undefined, tolerance: number): string | null {
  if (bodyScore(body, offset, tolerance) >= 0.85) return null;
  const c = DANCE_CONFIG.body;
  const o = offset ?? { x: 0, y: 0 };
  switch (body) {
    case 'squat':
      return o.y >= c.squatFrom ? 'Присядь глубже' : 'Присядь на бит';
    case 'jump':
      return 'Подпрыгни на бит';
    case 'step-left':
      return -o.x >= c.stepFrom ? 'Шагни ещё левее' : 'Шагни влево';
    case 'step-right':
      return o.x >= c.stepFrom ? 'Шагни ещё правее' : 'Шагни вправо';
  }
}

/**
 * Error mode for the dance floor: what the body still has to do and which arm is off.
 * "Higher" = towards 180° (up), "lower" = towards 0° (down).
 */
export function danceHint(input: DanceInput | null, pose: DancePose, tolerance = 1): string {
  if (!input) return 'Встань в кадр — тебя не видно';
  if (!input.visible) return 'Руки не видно — отойди на шаг назад';
  const fix = (side: 'Левую' | 'Правую', actual: number, target: number): string | null => {
    const diff = angleDiff(actual, target);
    if (diff <= DANCE_CONFIG.exactDeg * tolerance + 8) return null;
    if (actual < 0 && target > 20) return `${side} руку — в сторону, не перед собой`;
    return actual < target ? `${side} руку выше` : `${side} руку ниже`;
  };
  const l = fix('Левую', input.left, pose.left);
  const r = fix('Правую', input.right, pose.right);
  const arms = l && r ? `${l}, ${r.toLowerCase()}` : (l ?? r);
  const body = pose.body ? bodyFix(pose.body, input.body, tolerance) : null;
  if (!arms && !body) return 'Точно! Держи позу на бит';
  // The body first; with both arms off too, one short line instead of three instructions.
  if (body && arms) return l && r ? `${body} и руки как на карточке` : `${body}, ${arms.toLowerCase()}`;
  return body ?? arms ?? '';
}

/**
 * Follows where a dancer stands, so a squat, a jump or a step can be measured
 * against it. The spot drifts along with a dancer who wanders between body moves,
 * but stays put while a body move is coming (`hold`), and a squat never drags it down.
 */
export class DanceBodyTracker {
  private spot: { x: number; y: number; sw: number } | null = null;

  update(pose: Pose | null, dtMs: number, hold: boolean): BodyOffset | null {
    if (!pose) return null;
    const ls = lm(pose, LM.LEFT_SHOULDER);
    const rs = lm(pose, LM.RIGHT_SHOULDER);
    if (Math.min(ls.v, rs.v) < 0.4) return null;
    const x = (ls.x + rs.x) / 2;
    const y = (ls.y + rs.y) / 2;
    const sw = Math.max(1e-3, Math.hypot(rs.x - ls.x, rs.y - ls.y));
    if (!this.spot) {
      this.spot = { x, y, sw };
      return { x: 0, y: 0 };
    }
    const spot = this.spot;
    const offset = { x: (x - spot.x) / spot.sw, y: (y - spot.y) / spot.sw };
    if (!hold) {
      const k = 1 - Math.exp(-Math.max(0, dtMs) / DANCE_CONFIG.body.followMs);
      spot.x += (x - spot.x) * k;
      spot.sw += (sw - spot.sw) * k;
      if (Math.abs(offset.y) < DANCE_CONFIG.body.squatFrom) spot.y += (y - spot.y) * k;
    }
    return offset;
  }

  reset(): void {
    this.spot = null;
  }
}

export interface DanceMove {
  id: number;
  pose: DancePose;
  beat: number;
  /** Song time of the beat, ms. */
  at: number;
}

export type DanceGrade = 'perfect' | 'good' | 'miss';

export interface DancerState {
  score: number;
  combo: number;
  bestCombo: number;
  perfect: number;
  good: number;
  miss: number;
  /** Per pose id: attempts and summed match. */
  perPose: Record<string, { attempts: number; hits: number }>;
}

export interface DanceJudgement {
  player: number;
  move: DanceMove;
  grade: DanceGrade;
  match: number;
  points: number;
  combo: number;
}

const emptyDancer = (): DancerState => ({ score: 0, combo: 0, bestCombo: 0, perfect: 0, good: 0, miss: 0, perPose: {} });

/** Difficulty of the dance floor: judging window, pose tolerance and what a point is worth. */
export interface DanceTune {
  window: number;
  tolerance: number;
  score: number;
}

export const NORMAL_DANCE: DanceTune = { window: 1, tolerance: 1, score: 1 };

/**
 * Deterministic dance logic: song time + per-player arms and body in, judgements out.
 * Each move is judged by the best match a player reaches around its beat.
 */
export class DanceEngine {
  readonly moves: DanceMove[];
  readonly dancers: DancerState[];
  readonly duration: number;
  readonly tune: DanceTune;
  private next = 0;
  private readonly best: number[];

  constructor(moves: DanceMove[], players: number, tune: DanceTune = NORMAL_DANCE) {
    this.moves = moves;
    this.tune = tune;
    this.dancers = Array.from({ length: players }, emptyDancer);
    this.best = Array.from({ length: players }, () => 0);
    const last = moves[moves.length - 1];
    this.duration = (last?.at ?? 0) + 2000;
  }

  get finished(): boolean {
    return this.next >= this.moves.length;
  }

  /** The move being judged now or coming next. */
  get current(): DanceMove | null {
    return this.moves[this.next] ?? null;
  }

  multiplier(player: number): number {
    const c = DANCE_CONFIG;
    return Math.min(c.maxMultiplier, 1 + Math.floor((this.dancers[player]?.combo ?? 0) / c.comboPerMultiplier));
  }

  update(time: number, inputs: readonly (DanceInput | null)[]): DanceJudgement[] {
    const out: DanceJudgement[] = [];
    const { window: span, tolerance } = this.tune;
    for (;;) {
      const move = this.moves[this.next];
      if (!move) break;
      if (time >= move.at - DANCE_CONFIG.earlyMs * span) {
        inputs.forEach((a, i) => {
          if (a?.visible) this.best[i] = Math.max(this.best[i] ?? 0, poseMatch(a, move.pose, tolerance));
        });
      }
      if (time < move.at + DANCE_CONFIG.lateMs * span) break;
      this.dancers.forEach((d, i) => out.push(this.judge(i, d, move, this.best[i] ?? 0)));
      this.best.fill(0);
      this.next++;
    }
    return out;
  }

  private judge(player: number, d: DancerState, move: DanceMove, match: number): DanceJudgement {
    const c = DANCE_CONFIG;
    const grade: DanceGrade = match >= c.perfect ? 'perfect' : match >= c.good ? 'good' : 'miss';
    const stat = (d.perPose[move.pose.id] ??= { attempts: 0, hits: 0 });
    stat.attempts++;
    let points = 0;
    if (grade === 'miss') {
      d.miss++;
      d.combo = 0;
    } else {
      stat.hits++;
      d.combo++;
      d.bestCombo = Math.max(d.bestCombo, d.combo);
      points = Math.round((grade === 'perfect' ? c.points.perfect : c.points.good) * this.tune.score) * this.multiplier(player);
      d.score += points;
      if (grade === 'perfect') d.perfect++;
      else d.good++;
    }
    return { player, move, grade, match, points, combo: d.combo };
  }
}

export function danceAccuracy(d: DancerState): number {
  const total = d.perfect + d.good + d.miss;
  return total === 0 ? 0 : (d.perfect + d.good) / total;
}
