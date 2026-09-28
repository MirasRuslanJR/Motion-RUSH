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
