import { Calibrator, type Baseline, type CalibrationProgress } from '../gestures/calibration';
import { extractFeatures, extractGeometry, type BodyFeatures } from '../gestures/FeatureExtractor';
import { classify } from '../gestures/GestureClassifier';
import { GestureStateMachine } from '../gestures/GestureStateMachine';
import type { Lane } from '../gameplay/types';
import type { PlayerInput } from '../gameplay/GameEngine';
import { copyPoseInto, createPose, LM, lm, type Pose } from '../tracking/landmarks';
import { MotionSmoother } from '../tracking/MotionSmoother';

/** Pose loss shorter than this keeps the last pose (like the main engine). */
const HOLD_MS = 320;

/**
 * One player's own recognition pipeline for local two-player games:
 * smoothing → quick calibration → features → classifier → state machines.
 * The play area (lanes) is this player's half of the picture.
 */
export class PlayerTracker {
  readonly region: { x0: number; x1: number };
  baseline: Baseline | null = null;
  pose: Pose | null = null;
  features: BodyFeatures | null = null;
  calibration: CalibrationProgress = { progress: 0, issue: 'NOT_TRACKED', done: false };
  private readonly smoother = new MotionSmoother();
  private readonly calibrator = new Calibrator();
  private readonly lateral = new GestureStateMachine('lateral');
  private readonly vertical = new GestureStateMachine('vertical');
  private readonly buffer = createPose();
  private lastSeen = Number.NEGATIVE_INFINITY;

  constructor(region: { x0: number; x1: number }) {
    this.region = region;
  }

  get trackable(): boolean {
    return this.pose !== null;
  }

  /** Feed one inference result for this player (null = not in the picture). */
  update(raw: Pose | null, now: number): void {
    if (raw && Math.min(lm(raw, LM.LEFT_SHOULDER).v, lm(raw, LM.RIGHT_SHOULDER).v) >= 0.5) {
      this.lastSeen = now;
      this.pose = copyPoseInto(this.smoother.smooth(raw, now), this.buffer);
    } else if (now - this.lastSeen > HOLD_MS) {
      this.pose = null;
      this.smoother.reset();
    }
    const pose = this.pose;
    if (!this.baseline) {
      this.calibration = this.calibrator.push(pose ? extractGeometry(pose) : null, pose !== null, now);
      if (this.calibration.done && this.calibrator.baseline) this.baseline = { ...this.calibrator.baseline, region: this.region };
      return;
    }
    if (!pose) {
      this.features = null;
      this.lateral.reset(now);
      this.vertical.reset(now);
      return;
    }
    this.features = extractFeatures(pose, this.baseline);
    const c = classify(this.features, this.baseline.mode);
    const feats = { leanX: this.features.leanX, crouchDepth: this.features.crouchDepth, leftHandLift: this.features.leftHandLift, rightHandLift: this.features.rightHandLift };
    this.lateral.update(c, feats, now);
    this.vertical.update(c, feats, now);
  }

  input(): PlayerInput {
    const lateral = this.lateral.confirmed;
    const vertical = this.vertical.confirmed;
    const lane: Lane = lateral === 'LEAN_LEFT' ? -1 : lateral === 'LEAN_RIGHT' ? 1 : 0;
    return {
      trackable: this.pose !== null && this.baseline !== null,
      lane,
      jumpHeld: vertical === 'JUMP',
      crouchHeld: vertical === 'CROUCH',
      diagnosis: null,
      hint: null,
    };
  }
}

/** Splits the detected people between the left (P1) and right (P2) half of the picture. */
export function splitPlayers(people: readonly Pose[], aspect: number): [Pose | null, Pose | null] {
  const slots: [Pose | null, Pose | null] = [null, null];
  const mid = aspect / 2;
  for (const p of people) {
    const x = (lm(p, LM.LEFT_SHOULDER).x + lm(p, LM.RIGHT_SHOULDER).x) / 2;
    const side = x < mid ? 0 : 1;
    if (!slots[side]) slots[side] = p;
    else if (!slots[1 - side]) slots[1 - side] = p;
  }
  return slots;
}
