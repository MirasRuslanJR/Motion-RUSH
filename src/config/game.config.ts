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
  /** Fixed seed: every run is the same course, so scores are comparable. */
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
    firstArrivalMs: 3400,
    endPaddingMs: 1400,
    /** Opening sequence teaches every move once, in a fixed order. */
    intro: ['GATE_LEFT', 'HURDLE', 'GATE_RIGHT', 'BEAM'] as readonly ObstacleKind[],
    /** Extra gap when the player must swing from one side to the other. */
    crossoverPenaltyMs: 400,
    phases: [
      { untilMs: 18000, gapMs: [2700, 3100], leadMs: 2600, kinds: ['GATE_LEFT', 'GATE_RIGHT', 'HURDLE', 'BEAM'], orbChance: 0.35 },
      { untilMs: 36000, gapMs: [2200, 2500], leadMs: 2300, kinds: ['GATE_LEFT', 'GATE_RIGHT', 'HURDLE', 'BEAM'], orbChance: 0.4 },
      {
        untilMs: 54000,
        gapMs: [1850, 2150],
        leadMs: 2100,
        kinds: ['GATE_LEFT', 'GATE_RIGHT', 'HURDLE', 'BEAM', 'GATE_CENTER'],
        orbChance: 0.4,
      },
      {
        untilMs: 70000,
        gapMs: [1600, 1850],
        leadMs: 1900,
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
  /** Slow and forgiving — for learning the moves. */
  practice: {
    ...GAME_CONFIG.course,
    phases: [{ untilMs: 60000, gapMs: [3000, 3400], leadMs: 3000, kinds: BASIC, orbChance: 0.3 }],
  },
} satisfies Record<string, CourseConfig>;

export type CourseKind = keyof typeof COURSES;
