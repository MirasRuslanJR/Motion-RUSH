import { clamp } from '../../lib/math/geometry';
import { createRng } from '../gameplay/course';
import { LM, lm, type Pose } from '../tracking/landmarks';

/**
 * Dance Floor — match the shown pose on the beat.
 *
 * A pose is described by the direction of each arm, measured at the shoulder:
 *   0° = arm straight down, 90° = straight out to the side, 180° = straight up
 *   (negative = crossing in front of the body). Mirrored frame: the player's
 *   left arm is on the left of the screen, so the numbers read like a mirror.
 */
export interface DancePose {
  id: string;
  /** Short Russian name shown on the card. */
  title: string;
  left: number;
  right: number;
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
];

export const DANCE_CONFIG = {
  bpm: 120,
  /** Beats in the song (64 s at 120 bpm). */
  beats: 128,
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

function armScore(actual: number, target: number): number {
  const c = DANCE_CONFIG;
  return clamp(1 - (angleDiff(actual, target) - c.exactDeg) / (c.zeroDeg - c.exactDeg), 0, 1);
}

/** 0..1: how well the arms match the pose. */
export function poseMatch(angles: ArmAngles, pose: DancePose): number {
  return (armScore(angles.left, pose.left) + armScore(angles.right, pose.right)) / 2;
}

/**
 * Error mode for the dance floor: which arm is off and which way to move it.
 * "Higher" = towards 180° (up), "lower" = towards 0° (down).
 */
export function danceHint(angles: ArmAngles | null, pose: DancePose): string {
  if (!angles) return 'Встань в кадр — тебя не видно';
  if (!angles.visible) return 'Руки не видно — отойди на шаг назад';
  const fix = (side: 'Левую' | 'Правую', actual: number, target: number): string | null => {
    const diff = angleDiff(actual, target);
    if (diff <= DANCE_CONFIG.exactDeg + 8) return null;
    if (actual < 0 && target > 20) return `${side} руку — в сторону, не перед собой`;
    return actual < target ? `${side} руку выше` : `${side} руку ниже`;
  };
  const l = fix('Левую', angles.left, pose.left);
  const r = fix('Правую', angles.right, pose.right);
  if (!l && !r) return 'Точно! Держи позу на бит';
  if (l && r) return `${l}, ${r.toLowerCase()}`;
  return l ?? r ?? '';
}

export interface DanceMove {
  id: number;
  pose: DancePose;
  beat: number;
  /** Song time of the beat, ms. */
  at: number;
}

/** Random choreography: calm first (a pose every 2 bars), then a pose every 2 beats. */
export function generateChoreography(seed: number): DanceMove[] {
  const rng = createRng(seed);
  const moves: DanceMove[] = [];
  let prev: DancePose | null = null;
  const beats: number[] = [];
  for (let b = 8; b < 40; b += 4) beats.push(b);
  for (let b = 40; b < 88; b += 2) beats.push(b);
  for (let b = 88; b < DANCE_CONFIG.beats - 4; b += 2) beats.push(b);
  for (const beat of beats) {
    const options = DANCE_POSES.filter((p) => p !== prev);
    const pose = options[Math.floor(rng() * options.length)] ?? (DANCE_POSES[0] as DancePose);
    prev = pose;
    moves.push({ id: moves.length, pose, beat, at: beat * BEAT_MS });
  }
  return moves;
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

/**
 * Deterministic dance logic: song time + per-player arm angles in, judgements out.
 * Each move is judged by the best match a player reaches around its beat.
 */
export class DanceEngine {
  readonly moves: DanceMove[];
  readonly dancers: DancerState[];
  readonly duration: number;
  private next = 0;
  private readonly best: number[];

  constructor(moves: DanceMove[], players: number) {
    this.moves = moves;
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

  update(time: number, inputs: readonly (ArmAngles | null)[]): DanceJudgement[] {
    const out: DanceJudgement[] = [];
    const c = DANCE_CONFIG;
    for (;;) {
      const move = this.moves[this.next];
      if (!move) break;
      if (time >= move.at - c.earlyMs) {
        inputs.forEach((a, i) => {
          if (a?.visible) this.best[i] = Math.max(this.best[i] ?? 0, poseMatch(a, move.pose));
        });
      }
      if (time < move.at + c.lateMs) break;
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
      points = (grade === 'perfect' ? c.points.perfect : c.points.good) * this.multiplier(player);
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
