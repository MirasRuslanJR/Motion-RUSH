import type { ControlScheme, ExpectedMotion } from '../gestures/types';

/** -1 = left lane, 0 = centre, 1 = right lane. */
export type Lane = -1 | 0 | 1;

/**
 * GATE_LEFT / GATE_RIGHT / GATE_CENTER — walls with one open lane
 * HURDLE — low energy bar across all lanes (jump over)
 * BEAM   — overhead laser across all lanes (duck under)
 * ORB    — optional bonus pickup in a lane
 */
/**
 * Power-ups in a lane: SHIELD absorbs one miss, BOOST doubles points, MAGNET pulls
 * every energy orb in, SLOWMO slows time down, HEART gives a life back.
 */
export type PowerUpKind = 'SHIELD' | 'BOOST' | 'MAGNET' | 'SLOWMO' | 'HEART';
export type PickupKind = 'ORB' | PowerUpKind;
export type ObstacleKind = 'GATE_LEFT' | 'GATE_RIGHT' | 'GATE_CENTER' | 'HURDLE' | 'BEAM' | PickupKind;

export const POWER_UPS: readonly PowerUpKind[] = ['SHIELD', 'BOOST', 'MAGNET', 'SLOWMO', 'HEART'];

/** Optional pickups in a lane: ORB = points, the rest are power-ups. */
export function isPickup(kind: ObstacleKind): kind is PickupKind {
  switch (kind) {
    case 'ORB':
    case 'SHIELD':
    case 'BOOST':
    case 'MAGNET':
    case 'SLOWMO':
    case 'HEART':
      return true;
    default:
      return false;
  }
}

export const OBSTACLE_REQUIREMENT: Record<Exclude<ObstacleKind, PickupKind>, ExpectedMotion> = {
  GATE_LEFT: 'LEAN_LEFT',
  GATE_RIGHT: 'LEAN_RIGHT',
  GATE_CENTER: 'CENTER',
  HURDLE: 'JUMP',
  BEAM: 'CROUCH',
};

export interface CourseItem {
  id: number;
  kind: ObstacleKind;
  /** Game time (ms) when the obstacle reaches the runner. */
  arriveAt: number;
  /** Visible approach duration (ms). */
  leadMs: number;
  /** Lane for ORBs; open lane for gates. */
  lane: Lane;
}

export type ClearQuality = 'perfect' | 'good';

export interface MissReason {
  ruleId: string;
  message: string;
}

export interface ObstacleRecord {
  id: number;
  kind: ObstacleKind;
  /** Game time (ms) the obstacle reached the runner. */
  arriveAt: number;
  required: ExpectedMotion;
  result: ClearQuality | 'miss';
  /** How long before arrival the player was already in the correct pose (ms); null on a miss. */
  leadMs: number | null;
  /** An error-mode hint was shown while this obstacle was active. */
  hadErrorHint: boolean;
  /** Hint shown, then the player fixed the motion and cleared it. */
  corrected: boolean;
  missReason: MissReason | null;
}

export type GameOutcome = 'complete' | 'out-of-energy';

export interface SessionResult {
  /** Game mode id (see features/modes). */
  mode: string;
  /** Control scheme the run was played with. */
  scheme: ControlScheme;
  outcome: GameOutcome;
  score: number;
  bestCombo: number;
  durationMs: number;
  obstacles: ObstacleRecord[];
  gesturesDetected: number;
  hintsShown: number;
  orbsCollected: number;
  orbsTotal: number;
  /** Score sampled once per second of game time. */
  timeline: { t: number; score: number }[];
}
