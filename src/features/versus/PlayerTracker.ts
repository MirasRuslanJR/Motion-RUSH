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
import { StandGuide, STAND_ROOM_SW, type Placement, type StandZone } from './standZone';

/** Pose loss shorter than this keeps the last pose (like the main engine). */
const HOLD_MS = 320;

/** Two people side by side rarely stand perfectly still: a shorter, more tolerant capture. */
const QUICK_CALIBRATION = { ...GESTURE_CONFIG.calibration, durationMs: 1400, maxDriftSW: 0.24 };
/**
 * Two players share the width of one picture, so lanes are measured from each
 * player's own spot and follow the SHOULDERS: the lane area is ±this many
 * shoulder widths, and the step thresholds then ask for a ~0.4 SW (≈15 cm)
 * shift — a lean or one small step. Nobody has to walk toward the other player
 * or out of the picture.
 */
const LANE_HALF_SW = 1.3;
/** The picture changed shape after calibration (camera switched to wide): calibrate again. */
const ASPECT_CHANGE = 0.02;
/**
 * Two trackers run at about 5 frames a second, so a short hop is seen in one
 * frame at most. The single-player filter would cut that one frame's rise by a
 * third; this lighter one keeps ~87% of it…
 */
const DUO_SMOOTHING = { minCutoff: 5, beta: 3, dCutoff: 1 };
/** …and the rise counts a little more (the jump threshold becomes ~0.15 SW instead of 0.2). */
const JUMP_GAIN = 1.35;

function laneRegion(x: number, sw: number): { x0: number; x1: number } {
  return { x0: x - LANE_HALF_SW * sw, x1: x + LANE_HALF_SW * sw };
}

function toInput(d: Diagnosis | null): DiagnosisInput | null {
  return d ? { expected: d.expected, verdict: d.verdict, ruleId: d.ruleId, message: d.message } : null;
}

/**
 * One player's own recognition pipeline for local two-player games:
 * placement → smoothing → quick calibration → features → classifier → state
 * machines → error-mode diagnosis. Lanes are a lean or a small step left /
 * right of the spot the player calibrated on.
 */
export class PlayerTracker {
  /** 0 = player 1 (left half of the mirrored picture), 1 = player 2. */
  readonly side: 0 | 1;
  baseline: Baseline | null = null;
  pose: Pose | null = null;
  features: BodyFeatures | null = null;
  calibration: CalibrationProgress = { progress: 0, issue: 'NOT_TRACKED', done: false };
  /** Error-mode diagnosis for the motion this player's game expects right now. */
  diagnosis: Diagnosis | null = null;
  /** Set when a jump starts — the caller reads and clears it (e.g. "jump for a rematch"). */
  jumped = false;
  private readonly guide: StandGuide;
  private calibratedAspect = 0;
  private expected: ExpectedMotion | null = null;
  private readonly hints = new HintScheduler();
  private readonly smoother = new MotionSmoother(DUO_SMOOTHING);
  private readonly calibrator = new Calibrator(QUICK_CALIBRATION);
  private readonly lateral = new GestureStateMachine('lateral');
  private readonly vertical = new GestureStateMachine('vertical');
  private readonly buffer = createPose();
  private lastSeen = Number.NEGATIVE_INFINITY;
  private lastUpdate = 0;

  constructor(side: 0 | 1) {
    this.side = side;
    this.guide = new StandGuide(side, STAND_ROOM_SW.runner);
  }

  get trackable(): boolean {
    return this.pose !== null;
  }

  /** Before calibration: can both lane changes fit where the player stands (null = not seen)? */
  get placement(): Placement | null {
    return this.guide.placement;
  }

  /** Before calibration: where to stand (drawn on the setup camera); null once calibrated. */
  get standZone(): StandZone | null {
    return this.baseline ? null : this.guide.zone;
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

  /**
   * Feed one inference result for this player (null = not in their half of the
   * picture). `aspect` = frame width / height of that result.
   */
  update(raw: Pose | null, now: number, aspect: number): void {
    const dt = this.lastUpdate ? now - this.lastUpdate : 33;
    this.lastUpdate = now;
    if (this.baseline && Math.abs(aspect - this.calibratedAspect) > ASPECT_CHANGE) this.recalibrate(now);
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
      const placement = this.guide.update(geometry, aspect);
      if (placement !== null && placement !== 'ok') {
        // Calibrating here would leave no room for one of the lane changes.
        this.calibrator.reset();
        this.calibration = { progress: 0, issue: null, done: false };
        return;
      }
      this.calibration = this.calibrator.push(geometry, pose !== null, now);
      const captured = this.calibrator.baseline;
      if (this.calibration.done && captured) {
        this.baseline = { ...captured, laneFrom: 'shoulders', region: laneRegion(captured.shoulderCenter.x, captured.scale) };
        this.calibratedAspect = aspect;
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
    features.bodyRise *= JUMP_GAIN;
    this.features = features;
    const c = classify(features, this.baseline.mode);
    const feats = { leanX: features.leanX, crouchDepth: features.crouchDepth, leftHandLift: features.leftHandLift, rightHandLift: features.rightHandLift };
    const events = [...this.lateral.update(c, feats, now), ...this.vertical.update(c, feats, now)];
    if (events.some((e) => e.type === 'JUMP' && e.phase === 'start')) this.jumped = true;
    if (this.lateral.current.phase === 'NEUTRAL' && this.vertical.current.phase === 'NEUTRAL') {
      adaptBaselineDrift(this.baseline, features, dt);
      // The lane area follows the slowly re-centred neutral spot.
      this.baseline.region = laneRegion(this.baseline.shoulderCenter.x, this.baseline.scale);
    }
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
    const move = this.guide.message;
    if (move) return move;
    switch (this.calibration.issue) {
      case 'ARMS_UP':
        return 'Опусти руки';
      case 'MOVING':
        return 'Замри на секунду';
      default:
        return 'Стой ровно…';
    }
  }

  /** Positions from before a change of the picture's shape no longer match: start over. */
  private recalibrate(now: number): void {
    this.baseline = null;
    this.features = null;
    this.diagnosis = null;
    this.calibrator.reset();
    this.calibration = { progress: 0, issue: null, done: false };
    this.lateral.reset(now);
    this.vertical.reset(now);
    this.smoother.reset();
  }
}
