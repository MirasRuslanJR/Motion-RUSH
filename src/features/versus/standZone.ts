import type { Point } from '../../lib/math/geometry';

/** What a player must do before the game starts; left / right are their own (the picture is mirrored). */
export type Placement = 'ok' | 'move-left' | 'move-right' | 'step-back';

/** Where a player should stand, in frame units of the mirrored picture. */
export interface StandZone {
  x0: number;
  x1: number;
  /** The player stands inside it. */
  ok: boolean;
}

/** Room (in shoulder widths) at the outer edge and at the middle line that each two-player game needs. */
export const STAND_ROOM_SW = {
  /** Runner: a lean or a small step to either side, plus half a body. */
  runner: 1,
  /** Dance floor: an arm stretched to the side, at least up to the elbow. */
  dance: 1.6,
} as const;

/** Once inside their zone, a player may sway this far (SW) past its edge without being sent back. */
const ZONE_SLACK_SW = 0.15;
/** A zone narrower than this (SW) means the players stand too close to the camera. */
const MIN_ZONE_SW = 0.3;
/** Shoulder width assumed before the player is seen (frame units, ~3 m from a laptop camera). */
const DEFAULT_SW = 0.16;

const MESSAGES: Record<Exclude<Placement, 'ok'>, string> = {
  'move-left': 'Сдвинься левее',
  'move-right': 'Сдвинься правее',
  'step-back': 'Отойди на шаг назад',
};

/** The visible body: shoulder centre and width in frame units (null = not seen). */
export type BodySpot = { shoulderCenter: Point; shoulderWidth: number } | null;

/**
 * Two players at one camera: each one's spot is their half of the picture
 * minus `roomSW` shoulder widths at the outer edge and at the middle line —
 * the space their moves need. Tells the player which way to move until they
 * stand inside it.
 */
export class StandGuide {
  readonly side: 0 | 1;
  private readonly roomSW: number;
  placement: Placement | null = null;
  /** Where to stand (drawn on the camera); null when the two do not fit and must step back. */
  zone: StandZone | null = null;

  constructor(side: 0 | 1, roomSW: number) {
    this.side = side;
    this.roomSW = roomSW;
  }

  /** `aspect` = frame width / height (the zone moves with the picture's width). */
  update(body: BodySpot, aspect: number): Placement | null {
    const sw = body?.shoulderWidth ?? DEFAULT_SW;
    const middle = aspect / 2;
    const room = this.roomSW * sw;
    const x0 = this.side === 0 ? room : middle + room;
    const x1 = this.side === 0 ? middle - room : aspect - room;
    let placement: Placement | null = null;
    if (body) {
      const x = body.shoulderCenter.x;
      const slack = this.placement === 'ok' ? ZONE_SLACK_SW * sw : 0;
      if (x1 - x0 < MIN_ZONE_SW * sw) placement = 'step-back';
      else if (x < x0 - slack) placement = 'move-right';
      else if (x > x1 + slack) placement = 'move-left';
      else placement = 'ok';
    }
    this.placement = placement;
    this.zone = placement === 'step-back' || x1 <= x0 ? null : { x0, x1, ok: placement === 'ok' };
    return placement;
  }

  /** Short instruction, or null when the player is in place or not seen. */
  get message(): string | null {
    return this.placement && this.placement !== 'ok' ? MESSAGES[this.placement] : null;
  }
}
