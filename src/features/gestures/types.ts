import type { BodyPart } from '../tracking/landmarks';

export const GESTURE_TYPES = ['LEAN_LEFT', 'LEAN_RIGHT', 'JUMP', 'CROUCH'] as const;
export type GestureType = (typeof GESTURE_TYPES)[number];

/**
 * Gestures live on two independent channels so they can combine naturally:
 * you can stay leaned into the left lane AND raise your arms to jump.
 * Within a channel, conflicts are resolved by a fixed priority.
 */
export type GestureChannel = 'lateral' | 'vertical';

export const GESTURE_CHANNEL: Record<GestureType, GestureChannel> = {
  LEAN_LEFT: 'lateral',
  LEAN_RIGHT: 'lateral',
  JUMP: 'vertical',
  CROUCH: 'vertical',
};

/** Deterministic priority inside a channel (higher wins). */
export const GESTURE_PRIORITY: Record<GestureType, number> = {
  LEAN_LEFT: 1,
  LEAN_RIGHT: 1,
  JUMP: 2,
  CROUCH: 1,
};

/** What the game / tutorial currently wants from the player. CENTER = return to neutral. */
export type ExpectedMotion = GestureType | 'CENTER';

export type Arrow = 'up' | 'down' | 'left' | 'right';

export interface MotionMeta {
  /** Display name (HUD / cards). */
  title: string;
  /** Russian instruction shown as a cue. */
  cue: string;
  /** What it does in the game. */
  action: string;
  arrow: Arrow | null;
  focus: BodyPart[];
}

export const MOTION_META: Record<ExpectedMotion, MotionMeta> = {
  LEAN_LEFT: {
    title: 'Lean left',
    cue: 'Наклони корпус влево',
    action: 'Левая полоса',
    arrow: 'left',
    focus: ['shoulders', 'torso'],
  },
  LEAN_RIGHT: {
    title: 'Lean right',
    cue: 'Наклони корпус вправо',
    action: 'Правая полоса',
    arrow: 'right',
    focus: ['shoulders', 'torso'],
  },
  JUMP: {
    title: 'Arms up',
    cue: 'Подними обе руки над головой',
    action: 'Прыжок через барьер',
    arrow: 'up',
    focus: ['leftArm', 'rightArm'],
  },
  CROUCH: {
    title: 'Crouch',
    cue: 'Присядь — опусти плечи вниз',
    action: 'Пригнуться под лучом',
    arrow: 'down',
    focus: ['hips', 'torso'],
  },
  CENTER: {
    title: 'Center',
    cue: 'Встань ровно по центру',
    action: 'Центральная полоса',
    arrow: null,
    focus: ['shoulders', 'torso'],
  },
};

/** Compact, copyable feature summary attached to every gesture event. */
export interface GestureEventFeatures {
  leanX: number;
  crouchDepth: number;
  leftHandLift: number;
  rightHandLift: number;
}

export interface GestureEvent {
  type: GestureType;
  phase: 'start' | 'end';
  confidence: number;
  timestamp: number;
  features: GestureEventFeatures;
  source: 'pose-rules';
}
