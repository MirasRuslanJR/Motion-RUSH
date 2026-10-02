import { GESTURE_CONFIG } from '../../config/gesture.config';
import { adaptBaselineDrift, Calibrator, type Baseline, type CalibrationProgress } from '../gestures/calibration';
import { diagnose, HintScheduler, type Diagnosis } from '../gestures/ErrorDiagnosisEngine';
import { extractFeatures, extractGeometry, type BodyFeatures, type BodyGeometry } from '../gestures/FeatureExtractor';
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
 * Two players share the width of one picture, so lanes are measured from each
 * player's own spot and follow the SHOULDERS: the lane area is ±this many
 * shoulder widths, and the step thresholds then ask for a ~0.4 SW (≈15 cm)
 * shift — a lean or one small step. Nobody has to walk toward the other player
 * or out of the picture.
 */
const LANE_HALF_SW = 1.3;
/** Room a player needs on both sides of their spot (SW): the lane shift plus half a body. */
const ROOM_SW = 1;
/** Once inside their zone, a player may sway this far (SW) past its edge without restarting. */
const ZONE_SLACK_SW = 0.15;
/** A stand zone narrower than this (SW) means the players are too close to the camera. */
const MIN_ZONE_SW = 0.3;
/** Shoulder width assumed before the player is seen (frame units, ~2.5 m from a laptop camera). */
const DEFAULT_SW = 0.2;

/** What a player must do before calibrating; left / right are their own (the picture is mirrored). */
export type Placement = 'ok' | 'move-left' | 'move-right' | 'step-back';

/** Where a player should stand, in frame units of the mirrored picture. */
export interface StandZone {
  x0: number;
  x1: number;
  /** The player stands inside it. */
  ok: boolean;
}

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
  private readonly aspect: number;
  /** Before calibration: can both lane changes fit where the player stands (null = not seen)? */
  placement: Placement | null = null;
  /** Before calibration: where to stand (drawn on the setup camera); null once calibrated. */
  standZone: StandZone | null;
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
    this.aspect = aspect;
    this.standZone = { ...this.zoneFor(DEFAULT_SW), ok: false };
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
      this.placement = this.place(geometry);
      if (this.placement !== null && this.placement !== 'ok') {
        // Calibrating here would leave no room for one of the lane changes.
        this.calibrator.reset();
        this.calibration = { progress: 0, issue: null, done: false };
        return;
      }
      this.calibration = this.calibrator.push(geometry, pose !== null, now);
      const captured = this.calibrator.baseline;
      if (this.calibration.done && captured) {
        this.baseline = { ...captured, laneFrom: 'shoulders', region: laneRegion(captured.shoulderCenter.x, captured.scale) };
        this.standZone = null;
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
    switch (this.placement) {
      case 'step-back':
        return 'Отойди на шаг назад';
      case 'move-left':
        return 'Сдвинься левее';
      case 'move-right':
        return 'Сдвинься правее';
      default:
        break;
    }
    switch (this.calibration.issue) {
      case 'ARMS_UP':
        return 'Опусти руки';
      case 'MOVING':
        return 'Замри на секунду';
      default:
        return 'Стой ровно…';
    }
  }

  /** The player's half of the picture, minus room for a lane change on both sides. */
  private zoneFor(sw: number): { x0: number; x1: number } {
    const middle = this.aspect / 2;
    const room = ROOM_SW * sw;
    return this.side === 0 ? { x0: room, x1: middle - room } : { x0: middle + room, x1: this.aspect - room };
  }

  private place(geometry: BodyGeometry | null): Placement | null {
    const sw = geometry?.shoulderWidth ?? DEFAULT_SW;
    const zone = this.zoneFor(sw);
    let placement: Placement | null = null;
    if (geometry) {
      const x = geometry.shoulderCenter.x;
      const slack = this.placement === 'ok' ? ZONE_SLACK_SW * sw : 0;
      if (zone.x1 - zone.x0 < MIN_ZONE_SW * sw) placement = 'step-back';
      else if (x < zone.x0 - slack) placement = 'move-right';
      else if (x > zone.x1 + slack) placement = 'move-left';
      else placement = 'ok';
    }
    this.standZone = placement === 'step-back' ? null : { ...zone, ok: placement === 'ok' };
    return placement;
  }
}
