import type { ObstacleKind } from '../features/gameplay/types';

export interface CoursePhase {
  /** Phase ends when obstacle arrival time reaches this (ms of game time). */
  untilMs: number;
  /** Gap between consecutive required obstacles, ms [min, max]. */
  gapMs: readonly [number, number];
  /** How long an obstacle is visible before it reaches the player, ms. */
  leadMs: number;
  kinds: readonly ObstacleKind[];
  /** Chance of an energy orb between two obstacles. */
  orbChance: number;
}

/** GAME_CONFIG — gameplay tuning. Game time is paused while tracking is lost. */
export const GAME_CONFIG = {
  /** Default seed for tests and tools. Real runs use a new random seed every time (see modes). */
  seed: 0x4d4f54,
  energy: 5,
  countdownStepMs: 800,
  goHoldMs: 500,

  /** A jump keeps the runner airborne this long after the arms went up. */
  airtimeMs: 700,
  /** Ducking lingers briefly after standing up. */
  duckGraceMs: 220,
  /** Allowed lateness after an obstacle reaches the runner. */
  clearGraceMs: 200,
  /** Being in position this early before arrival = PERFECT. */
  perfectLeadMs: 300,
  /** An obstacle becomes the active "expected motion" this long before arrival. */
  promptWindowMs: 1800,
  orbWindowMs: 160,

  /** Tracking must be missing this long before the game pauses… */
  lostGraceMs: 450,
  /** …and stable this long before it resumes. */
  resumeStableMs: 700,
  resumeCountdownMs: 1200,

  scoring: {
    clear: 100,
    perfect: 150,
    orb: 30,
    comboPerMultiplier: 5,
    maxMultiplier: 4,
  },

  /** Power-ups: a shield absorbs one miss, a boost doubles points for a while. */
  powerUps: {
    /** Share of pickups that are power-ups instead of plain orbs. */
    chance: 0.18,
    boostMs: 8000,
    boostMultiplier: 2,
  },

  course: {
    firstArrivalMs: 3000,
    endPaddingMs: 1400,
    /** Opening sequence teaches every move once, in a fixed order. */
    intro: ['GATE_LEFT', 'HURDLE', 'GATE_RIGHT', 'BEAM'] as readonly ObstacleKind[],
    /** Extra gap when the player must swing from one side to the other. */
    crossoverPenaltyMs: 400,
    phases: [
      { untilMs: 16000, gapMs: [2300, 2600], leadMs: 2300, kinds: ['GATE_LEFT', 'GATE_RIGHT', 'HURDLE', 'BEAM'], orbChance: 0.35 },
      { untilMs: 34000, gapMs: [1900, 2150], leadMs: 2050, kinds: ['GATE_LEFT', 'GATE_RIGHT', 'HURDLE', 'BEAM'], orbChance: 0.4 },
      {
        untilMs: 52000,
        gapMs: [1650, 1850],
        leadMs: 1850,
        kinds: ['GATE_LEFT', 'GATE_RIGHT', 'HURDLE', 'BEAM', 'GATE_CENTER'],
        orbChance: 0.4,
      },
      {
        untilMs: 70000,
        gapMs: [1400, 1600],
        leadMs: 1700,
        kinds: ['GATE_LEFT', 'GATE_RIGHT', 'HURDLE', 'BEAM', 'GATE_CENTER'],
        orbChance: 0.3,
      },
    ] as readonly CoursePhase[],
  },
} as const;

export interface CourseConfig {
  firstArrivalMs: number;
  endPaddingMs: number;
  intro: readonly ObstacleKind[];
  crossoverPenaltyMs: number;
  phases: readonly CoursePhase[];
}

const ALL: readonly ObstacleKind[] = ['GATE_LEFT', 'GATE_RIGHT', 'HURDLE', 'BEAM', 'GATE_CENTER'];
const BASIC: readonly ObstacleKind[] = ['GATE_LEFT', 'GATE_RIGHT', 'HURDLE', 'BEAM'];

/** Course presets used by the game modes. */
export const COURSES = {
  /** ~70 s, four difficulty phases. */
  standard: GAME_CONFIG.course,
  /** 30 s, dense from the start. */
  sprint: {
    ...GAME_CONFIG.course,
    firstArrivalMs: 2600,
    phases: [{ untilMs: 30000, gapMs: [1500, 1800], leadMs: 2000, kinds: ALL, orbChance: 0.4 }],
  },
  /** Keeps accelerating for 10 minutes — in practice, until the energy runs out. */
  endless: {
    ...GAME_CONFIG.course,
    phases: [
      ...GAME_CONFIG.course.phases,
      { untilMs: 100000, gapMs: [1450, 1650], leadMs: 1800, kinds: ALL, orbChance: 0.3 },
      { untilMs: 140000, gapMs: [1300, 1450], leadMs: 1650, kinds: ALL, orbChance: 0.3 },
      { untilMs: 600000, gapMs: [1150, 1300], leadMs: 1500, kinds: ALL, orbChance: 0.25 },
    ],
  },
  /** 45 s at full speed from the first second. */
  blitz: {
    ...GAME_CONFIG.course,
    firstArrivalMs: 2400,
    phases: [
      { untilMs: 25000, gapMs: [1350, 1500], leadMs: 1650, kinds: ALL, orbChance: 0.35 },
      { untilMs: 45000, gapMs: [1200, 1350], leadMs: 1500, kinds: ALL, orbChance: 0.3 },
    ],
  },
  /** Only jumps and squats — a leg workout. */
  vertical: {
    ...GAME_CONFIG.course,
    intro: ['HURDLE', 'BEAM'],
    phases: [
      { untilMs: 30000, gapMs: [1800, 2100], leadMs: 2000, kinds: ['HURDLE', 'BEAM'], orbChance: 0.3 },
      { untilMs: 60000, gapMs: [1450, 1650], leadMs: 1750, kinds: ['HURDLE', 'BEAM'], orbChance: 0.3 },
    ],
  },
  /** Only gates — keep moving between the lanes. */
  lanes: {
    ...GAME_CONFIG.course,
    intro: ['GATE_LEFT', 'GATE_RIGHT', 'GATE_CENTER'],
    crossoverPenaltyMs: 300,
    phases: [
      { untilMs: 30000, gapMs: [1900, 2200], leadMs: 2000, kinds: ['GATE_LEFT', 'GATE_RIGHT', 'GATE_CENTER'], orbChance: 0.45 },
      { untilMs: 60000, gapMs: [1550, 1750], leadMs: 1750, kinds: ['GATE_LEFT', 'GATE_RIGHT', 'GATE_CENTER'], orbChance: 0.45 },
    ],
  },
  /**
   * Two players at one camera: calmer and steadier. Two trackers run at about
   * half the single-player rate, and both players also watch each other.
   */
  duo: {
    ...GAME_CONFIG.course,
    crossoverPenaltyMs: 600,
    phases: [
      { untilMs: 22000, gapMs: [2700, 3000], leadMs: 2700, kinds: BASIC, orbChance: 0.35 },
      { untilMs: 46000, gapMs: [2350, 2650], leadMs: 2450, kinds: BASIC, orbChance: 0.35 },
      { untilMs: 66000, gapMs: [2100, 2350], leadMs: 2250, kinds: ALL, orbChance: 0.3 },
    ],
  },
  /** Slow and forgiving — for learning the moves. */
  practice: {
    ...GAME_CONFIG.course,
    phases: [{ untilMs: 60000, gapMs: [3000, 3400], leadMs: 3000, kinds: BASIC, orbChance: 0.3 }],
  },
} satisfies Record<string, CourseConfig>;

export type CourseKind = keyof typeof COURSES;
