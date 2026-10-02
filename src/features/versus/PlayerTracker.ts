import { GESTURE_CONFIG } from '../../config/gesture.config';
import { adaptBaselineDrift, Calibrator, type Baseline, type CalibrationProgress } from '../gestures/calibration';
import { diagnose, HintScheduler, type Diagnosis } from '../gestures/ErrorDiagnosisEngine';
import { extractFeatures, extractGeometry, type BodyFeatures } from '../gestures/FeatureExtractor';
import { classify } from '../gestures/GestureClassifier';
import { GestureStateMachine } from '../gestures/GestureStateMachine';
import type { ExpectedMotion } from '../gestures/types';
import type { DiagnosisInput, PlayerInput } from '../gameplay/GameEngine';
import type { Lane } from '../gameplay/types';
import { copyPoseInto, createPose, LM, lm, type Pose } from '../tracking/landmarks';
import { MotionSmoother } from '../tracking/MotionSmoother';

/** Pose loss shorter than this keeps the last pose (like the main engine). */
const HOLD_MS = 320;

/** Two people side by side rarely stand perfectly still: a shorter, more tolerant capture. */
const QUICK_CALIBRATION = { ...GESTURE_CONFIG.calibration, durationMs: 1400, maxDriftSW: 0.24 };
/**
 * Lanes for two players are measured from where each player stood at
 * calibration (±this many shoulder widths), not from the halves of the
 * picture — so changing lane is one short step from your own spot and never
 * means walking over to the other player.
 */
const LANE_HALF_SW = 2;
/** Each player must stand at least this far (shoulder widths) from the middle line. */
const MIN_GAP_SW = 1.4;

function toInput(d: Diagnosis | null): DiagnosisInput | null {
  return d ? { expected: d.expected, verdict: d.verdict, ruleId: d.ruleId, message: d.message } : null;
}

/**
 * One player's own recognition pipeline for local two-player games:
 * smoothing → quick calibration → features → classifier → state machines →
 * error-mode diagnosis. Lanes are a short step left / right of the spot the
 * player calibrated on.
 */
export class PlayerTracker {
  /** 0 = player 1 (left half of the mirrored picture), 1 = player 2. */
  readonly side: 0 | 1;
  private readonly middle: number;
  /** Standing too close to the middle line — calibration waits. */
  tooCloseToMiddle = false;
  baseline: Baseline | null = null;
  pose: Pose | null = null;
  features: BodyFeatures | null = null;
  calibration: CalibrationProgress = { progress: 0, issue: 'NOT_TRACKED', done: false };
  /** Error-mode diagnosis for the motion this player's game expects right now. */
  diagnosis: Diagnosis | null = null;
  /** Set when a jump starts — the caller reads and clears it (e.g. "jump for a rematch"). */
  jumped = false;
  private expected: ExpectedMotion | null = null;
  private readonly hints = new HintScheduler();
  private readonly smoother = new MotionSmoother();
  private readonly calibrator = new Calibrator(QUICK_CALIBRATION);
  private readonly lateral = new GestureStateMachine('lateral');
  private readonly vertical = new GestureStateMachine('vertical');
  private readonly buffer = createPose();
  private lastSeen = Number.NEGATIVE_INFINITY;
  private lastUpdate = 0;

  constructor(side: 0 | 1, aspect: number) {
    this.side = side;
    this.middle = aspect / 2;
  }

  get trackable(): boolean {
    return this.pose !== null;
  }

  /** The throttled hint actually shown to the player. */
  get hint(): Diagnosis | null {
    return this.hints.current;
  }

  setExpected(expected: ExpectedMotion | null): void {
    if (expected === this.expected) return;
    this.expected = expected;
    this.diagnosis = null;
    this.hints.reset();
  }

  /** Feed one inference result for this player (null = not in their half of the picture). */
  update(raw: Pose | null, now: number): void {
    const dt = this.lastUpdate ? now - this.lastUpdate : 33;
    this.lastUpdate = now;
    if (raw && Math.min(lm(raw, LM.LEFT_SHOULDER).v, lm(raw, LM.RIGHT_SHOULDER).v) >= 0.5) {
      this.lastSeen = now;
      this.pose = copyPoseInto(this.smoother.smooth(raw, now), this.buffer);
    } else if (now - this.lastSeen > HOLD_MS) {
      this.pose = null;
      this.smoother.reset();
    }
    const pose = this.pose;
    if (!this.baseline) {
      const geometry = pose ? extractGeometry(pose) : null;
      // Too close to the middle: a lane step would cross into the other player's half.
      const spot = geometry ? (geometry.hipCenter ?? geometry.shoulderCenter).x : null;
      this.tooCloseToMiddle = geometry !== null && spot !== null && Math.abs(spot - this.middle) < MIN_GAP_SW * geometry.shoulderWidth;
      if (this.tooCloseToMiddle) {
        this.calibrator.reset();
        this.calibration = { progress: 0, issue: null, done: false };
        return;
      }
      this.calibration = this.calibrator.push(geometry, pose !== null, now);
      const captured = this.calibrator.baseline;
      if (this.calibration.done && captured) {
        const x = (captured.hipCenter ?? captured.shoulderCenter).x;
        const half = LANE_HALF_SW * captured.scale;
        this.baseline = { ...captured, region: { x0: x - half, x1: x + half } };
      }
      return;
    }
    if (!pose) {
      this.features = null;
      this.diagnosis = null;
      this.lateral.reset(now);
      this.vertical.reset(now);
      this.hints.update(null, now);
      return;
    }
    const features = extractFeatures(pose, this.baseline);
    this.features = features;
    const c = classify(features, this.baseline.mode);
    const feats = { leanX: features.leanX, crouchDepth: features.crouchDepth, leftHandLift: features.leftHandLift, rightHandLift: features.rightHandLift };
    const events = [...this.lateral.update(c, feats, now), ...this.vertical.update(c, feats, now)];
    if (events.some((e) => e.type === 'JUMP' && e.phase === 'start')) this.jumped = true;
    if (this.lateral.current.phase === 'NEUTRAL' && this.vertical.current.phase === 'NEUTRAL') adaptBaselineDrift(this.baseline, features, dt);
    this.diagnosis = this.expected ? diagnose(this.expected, features, c, this.baseline, now) : null;
    this.hints.update(this.diagnosis, now);
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
      diagnosis: toInput(this.diagnosis),
      hint: toInput(this.hints.current),
    };
  }

  /** One short line for the setup screen. */
  get setupStatus(): string {
    if (this.baseline) return 'Готов!';
    if (!this.pose) return 'Не вижу — встань в свою половину';
    if (this.tooCloseToMiddle) return 'Отойди на шаг от середины';
    switch (this.calibration.issue) {
      case 'ARMS_UP':
        return 'Опусти руки';
      case 'MOVING':
        return 'Замри на секунду';
      default:
        return 'Стой ровно…';
    }
  }
}
