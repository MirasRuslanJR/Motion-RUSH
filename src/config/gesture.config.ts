/**
 * GESTURE_CONFIG — single source of truth for recognition + error-mode tuning.
 *
 * Units are BODY-RELATIVE, measured against the calibration baseline:
 *   SW  = shoulder width captured during calibration
 *   ARM = arm length (shoulder→elbow→wrist) captured during calibration
 * so the same numbers work for a child 1 m from the camera and an adult at 3 m.
 *
 * Two control schemes, chosen automatically by calibration:
 *   body   — hips visible (standing back): real steps, real jumps, real squats
 *   seated — upper body only (at a desk): shoulder lean, arms up, duck
 *
 * For each gesture:
 *   rest        metric value of a neutral standing pose (0% progress)
 *   near        metric above which we consider the user is TRYING (error mode kicks in)
 *   activation  metric required to recognise the gesture (100% progress)
 *   release     metric below which a recognised gesture ends (hysteresis: release < activation)
 */
export const GESTURE_CONFIG = {
  /** ── seated scheme ── */
  lean: {
    /** Metric: lateral shift of the shoulder centre, in SW (sign by direction). */
    rest: 0,
    near: 0.12,
    activation: 0.38,
    release: 0.22,
    /** Head moved this far sideways (SW)… */
    headOnlyHeadShift: 0.28,
    /** …while shoulders stayed under this (SW) → "you only tilt your head". */
    headOnlyShoulderShift: 0.14,
    /** Shoulder width shrank below this ratio of baseline → body turned sideways. */
    turnedScaleRatio: 0.72,
  },
  jump: {
    /** Metric: height of the LOWER wrist above its shoulder, in ARM. */
    rest: -0.9,
    near: -0.15,
    activation: 0.42,
    release: 0.22,
    /** Elbow angle (deg) under which the arm counts as bent. */
    bentElbowDeg: 130,
    /** When a wrist leaves the frame, an elbow this high (ARM) still counts as "arm up". */
    elbowFallbackLift: 0.2,
    /** Wrist lift estimated from elbow lift when the wrist is out of frame. */
    elbowToWristFactor: 1.9,
  },
  crouch: {
    /** Metric: how far the shoulder centre dropped below its sitting height, in SW. */
    rest: 0,
    near: 0.12,
    activation: 0.3,
    release: 0.17,
    /** Nose dropped this much (SW) while shoulders did not → "only your head moves". */
    headOnlyNoseDrop: 0.3,
    /** Sideways drift (SW) during a crouch → "keep your torso centred". */
    maxLateralDrift: 0.34,
  },

  /** ── body scheme (full body visible) ── */
  body: {
    step: {
      /** Metric: lateral shift of the HIP centre (the whole body moves), in SW. */
      rest: 0,
      near: 0.12,
      activation: 0.4,
      release: 0.24,
      /** Shoulders moved this far while hips stayed → "only the upper body moves". */
      shouldersOnlyShift: 0.3,
    },
    jump: {
      /** Metric: how far hips AND shoulders rose above standing height, in SW. */
      rest: 0,
      near: 0.07,
      activation: 0.2,
      release: 0.1,
      /** Hands this high (ARM) without a body rise → "arms don't count, jump". */
      armsOnlyLift: 0.2,
    },
    squat: {
      /** Metric: hip drop below standing height, in SW. */
      rest: 0,
      near: 0.1,
      activation: 0.32,
      release: 0.18,
      /** Shoulders dropped this much (SW) while hips did not → bowing, not squatting. */
      bowShoulderDrop: 0.28,
      maxLateralDrift: 0.4,
    },
  },

  center: {
    /** |lateral shift| under this (SW) counts as centred. */
    tolerance: 0.2,
  },
  stateMachine: {
    /** A candidate must hold for this many inference frames… */
    stableFrames: 2,
    /** …and at least this long before it is confirmed. */
    stableMs: 70,
    /** A real jump is airborne only ~300–400 ms: confirm it on the first clear frame. */
    fastStableFrames: 1,
    fastStableMs: 0,
    /** After a gesture ends, the same gesture cannot re-trigger for this long. */
    cooldownMs: 200,
    /** Minimum confidence to confirm a candidate. */
    requiredConfidence: 0.5,
  },
  hints: {
    /** A new diagnosis must persist this long before it is shown. */
    debounceMs: 220,
    /** A shown hint stays at least this long before being replaced by another hint. */
    minDisplayMs: 900,
  },
  calibration: {
    durationMs: 2200,
    /** Shoulder centre may drift at most this much (SW) during capture. */
    maxDriftSW: 0.16,
    /** Fallback arm length (in SW) when wrists are not visible during calibration. */
    fallbackArmSW: 1.55,
    minArmSW: 1.1,
    maxArmSW: 2.1,
    /** Slow re-centring of the neutral position while the player stands still. */
    driftAdaptTauMs: 5000,
    driftAdaptMaxShift: 0.1,
  },
} as const;

export type GestureConfig = typeof GESTURE_CONFIG;
