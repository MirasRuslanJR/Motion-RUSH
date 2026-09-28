import { TRACKING_CONFIG } from '../../config/tracking.config';
import { Store } from '../../lib/store';
import { Debounced, RateMeter } from '../../lib/timing';
import { CameraSource } from '../camera/CameraSource';
import { classifyCameraError, type CameraErrorKind } from '../camera/cameraErrors';
import { LightMeter } from '../camera/LightMeter';
import { adaptBaselineDrift, type Baseline } from '../gestures/calibration';
import { diagnose, HintScheduler, type Diagnosis } from '../gestures/ErrorDiagnosisEngine';
import { extractFeatures, type BodyFeatures } from '../gestures/FeatureExtractor';
import { classify, type Classification } from '../gestures/GestureClassifier';
import { GestureStateMachine, type ChannelState } from '../gestures/GestureStateMachine';
import { buildTargetPose } from '../gestures/targetPose';
import type { ExpectedMotion, GestureEvent, GestureEventFeatures, GestureType } from '../gestures/types';
import { assessFrame, isTrackable, NO_BODY_QUALITY, trackingMessage, type FrameQuality, type TrackingStatus } from '../tracking/frameQuality';
import { normalizeLandmarks } from '../tracking/LandmarkNormalizer';
import { copyPoseInto, createPose, type Pose } from '../tracking/landmarks';
import { MotionSmoother } from '../tracking/MotionSmoother';
import { loadPoseTracker, type Delegate, type PoseTracker } from '../tracking/PoseTracker';
import { selectPrimaryPose } from '../tracking/poseSelection';

/** Low-frequency state for React. Changes a few times per second at most. */
export interface MotionUiState {
  camera: 'idle' | 'starting' | 'live' | 'error';
  cameraError: CameraErrorKind | null;
  model: 'loading' | 'ready' | 'error';
  delegate: Delegate | null;
  tracking: TrackingStatus;
  trackingMessage: string;
  lowLight: boolean;
  lowHeadroom: boolean;
  multiplePeople: boolean;
  lateral: GestureType | null;
  vertical: GestureType | null;
  /** Throttled error-mode hint for the current expectation. */
  hint: Diagnosis | null;
}

/** High-frequency snapshot, mutated in place every animation frame. Never put it in React state. */
export interface MotionFrame {
  time: number;
  /** A new inference result arrived this frame. */
  inferred: boolean;
  aspect: number;
  videoWidth: number;
  videoHeight: number;
  pose: Pose | null;
  quality: FrameQuality;
  trackable: boolean;
  features: BodyFeatures | null;
  classification: Classification | null;
  lateral: Readonly<ChannelState>;
  vertical: Readonly<ChannelState>;
  expected: ExpectedMotion | null;
  diagnosis: Diagnosis | null;
  target: Pose | null;
  baseline: Baseline | null;
  stats: { fps: number; inferenceFps: number; inferenceMs: number; targetInferenceFps: number };
}

export type FrameListener = (frame: Readonly<MotionFrame>, dtMs: number) => void;
export type GestureListener = (event: GestureEvent) => void;

const INITIAL_UI: MotionUiState = {
  camera: 'idle',
  cameraError: null,
  model: 'loading',
  delegate: null,
  tracking: 'NO_BODY',
  trackingMessage: trackingMessage(NO_BODY_QUALITY),
  lowLight: false,
  lowHeadroom: false,
  multiplePeople: false,
  lateral: null,
  vertical: null,
  hint: null,
};

function summary(f: BodyFeatures | null): GestureEventFeatures | null {
  if (!f) return null;
  return { leanX: f.leanX, crouchDepth: f.crouchDepth, leftHandLift: f.leftHandLift, rightHandLift: f.rightHandLift };
}

/**
 * Realtime Motion Engine.
 *
 *   CameraSource → PoseTracker → LandmarkNormalizer → MotionSmoother
 *     → FeatureExtractor → GestureClassifier → GestureStateMachine (×2 channels)
 *     → ErrorDiagnosisEngine → listeners (game, renderers) / Store (React)
 *
 * Runs its own requestAnimationFrame loop. Inference is throttled adaptively
 * (12–30 Hz) while rendering listeners run every display frame.
 */
export class MotionEngine {
  readonly ui = new Store<MotionUiState>(INITIAL_UI);
  readonly frame: MotionFrame;

  private readonly camera = new CameraSource();
  private readonly smoother = new MotionSmoother();
  private readonly lateralSM = new GestureStateMachine('lateral');
  private readonly verticalSM = new GestureStateMachine('vertical');
  private readonly hints = new HintScheduler();
  private readonly lightMeter = new LightMeter();
  private readonly frameListeners = new Set<FrameListener>();
  private readonly gestureListeners = new Set<GestureListener>();

  private readonly rawPose = createPose();
  private readonly poseBuffer = createPose();
  private readonly targetBuffer = createPose();
  private readonly status = new Debounced<TrackingStatus>('NO_BODY', TRACKING_CONFIG.statusDebounceMs);
  private readonly fpsMeter = new RateMeter();
  private readonly inferenceMeter = new RateMeter();

  private tracker: PoseTracker | null = null;
  private raf = 0;
  private lastTick = 0;
  private lastInferenceAt = 0;
  private lastVideoTime = -1;
  private lastSeenAt = 0;
  private lastLightSampleAt = 0;
  private targetFps: number = TRACKING_CONFIG.inference.maxFps;
  private lastRateChangeAt = 0;
  private avgInferenceMs = 0;
  private othersSince: number | null = null;
  private othersGoneSince: number | null = null;
  private primaryCenter: { x: number; y: number } | null = null;
  private disposed = false;

  constructor() {
    this.frame = {
      time: 0,
      inferred: false,
      aspect: 4 / 3,
      videoWidth: 0,
      videoHeight: 0,
      pose: null,
      quality: NO_BODY_QUALITY,
      trackable: false,
      features: null,
      classification: null,
      lateral: this.lateralSM.current,
      vertical: this.verticalSM.current,
      expected: null,
      diagnosis: null,
      target: null,
      baseline: null,
      stats: { fps: 0, inferenceFps: 0, inferenceMs: 0, targetInferenceFps: this.targetFps },
    };
  }

  get video(): HTMLVideoElement {
    return this.camera.video;
  }

  get baseline(): Baseline | null {
    return this.frame.baseline;
  }

  ensureVideoPlaying(): void {
    this.camera.ensurePlaying();
  }

  /** Opens the camera, starts the loop and attaches the (pre)loaded pose model. */
  async start(): Promise<void> {
    this.ui.set({ camera: 'starting', cameraError: null });
    try {
      await this.camera.start();
    } catch (error) {
      this.ui.set({ camera: 'error', cameraError: classifyCameraError(error) });
      throw error;
    }
    if (this.disposed) {
      this.camera.stop();
      return;
    }
    this.camera.onEnded(() => this.ui.set({ camera: 'error', cameraError: 'ended' }));
    this.ui.set({ camera: 'live' });
    this.raf = requestAnimationFrame(this.tick);

    try {
      const tracker = await loadPoseTracker();
      if (this.disposed) return;
      this.tracker = tracker;
      this.ui.set({ model: 'ready', delegate: tracker.delegate });
    } catch {
      this.ui.set({ model: 'error', camera: 'error', cameraError: 'model' });
    }
  }

  setBaseline(baseline: Baseline | null): void {
    this.frame.baseline = baseline
      ? {
          ...baseline,
          shoulderCenter: { ...baseline.shoulderCenter },
          nose: { ...baseline.nose },
          hipCenter: baseline.hipCenter ? { ...baseline.hipCenter } : null,
        }
      : null;
    this.emit([...this.lateralSM.reset(this.frame.time), ...this.verticalSM.reset(this.frame.time)]);
  }

  /** What the current screen wants from the player; drives the error-mode diagnosis. */
  setExpected(expected: ExpectedMotion | null): void {
    if (this.frame.expected === expected) return;
    this.frame.expected = expected;
    this.frame.diagnosis = null;
    this.frame.target = null;
    this.hints.reset();
    this.ui.set({ hint: null });
  }

  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  }

  onGesture(listener: GestureListener): () => void {
    this.gestureListeners.add(listener);
    return () => {
      this.gestureListeners.delete(listener);
    };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.camera.stop();
    this.frameListeners.clear();
    this.gestureListeners.clear();
  }

  private readonly tick = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const dt = this.lastTick ? Math.min(now - this.lastTick, 100) : 16;
    this.lastTick = now;
    this.fpsMeter.tick(now);

    this.frame.time = now;
    this.frame.inferred = false;
    if (this.shouldInfer(now)) this.infer(now);

    this.frame.stats.fps = this.fpsMeter.rate;
    for (const listener of this.frameListeners) listener(this.frame, dt);
  };

  private shouldInfer(now: number): boolean {
    const video = this.camera.video;
    if (!this.tracker || video.readyState < 2 || video.videoWidth === 0) return false;
    if (video.currentTime === this.lastVideoTime) return false;
    return now - this.lastInferenceAt >= 1000 / this.targetFps - 2;
  }

  private adaptInferenceRate(now: number, ms: number): void {
    this.avgInferenceMs = this.avgInferenceMs === 0 ? ms : this.avgInferenceMs * 0.9 + ms * 0.1;
    if (now - this.lastRateChangeAt < 500) return;
    const { maxFps, minFps, loadFactor } = TRACKING_CONFIG.inference;
    const budget = 1000 / this.targetFps;
    if (this.avgInferenceMs > budget * loadFactor && this.targetFps > minFps) {
      this.targetFps = Math.max(minFps, this.targetFps - 3);
      this.lastRateChangeAt = now;
    } else if (this.avgInferenceMs < budget * loadFactor * 0.5 && this.targetFps < maxFps) {
      this.targetFps = Math.min(maxFps, this.targetFps + 1);
      this.lastRateChangeAt = now;
    }
  }

  private infer(now: number): void {
    const tracker = this.tracker;
    if (!tracker) return;
    const video = this.camera.video;
    const dtSinceLast = this.lastInferenceAt ? now - this.lastInferenceAt : 33;
    this.lastInferenceAt = now;
    this.lastVideoTime = video.currentTime;

    const started = performance.now();
    let poses;
    try {
      poses = tracker.detect(video, now);
    } catch {
      this.ui.set({ model: 'error', camera: 'error', cameraError: 'model' });
      return;
    }
    const elapsed = performance.now() - started;
    this.adaptInferenceRate(now, elapsed);
    this.inferenceMeter.tick(now);

    const f = this.frame;
    f.inferred = true;
    f.videoWidth = video.videoWidth;
    f.videoHeight = video.videoHeight;
    f.aspect = video.videoWidth / video.videoHeight;
    f.stats.inferenceMs = this.avgInferenceMs;
    f.stats.inferenceFps = this.inferenceMeter.rate;
    f.stats.targetInferenceFps = this.targetFps;

    // 1. Pick the player, track bystanders.
    const selection = selectPrimaryPose(poses, f.aspect, this.primaryCenter);
    this.updateMultiPerson(selection.significantOthers > 0, now);

    // 2. Normalise + smooth, with a short hold on momentary landmark loss.
    const primary = selection.primaryIndex >= 0 ? poses[selection.primaryIndex] : undefined;
    if (primary) {
      this.primaryCenter = selection.primaryCenter;
      this.lastSeenAt = now;
      normalizeLandmarks(primary, f.aspect, true, this.rawPose);
      f.pose = copyPoseInto(this.smoother.smooth(this.rawPose, now), this.poseBuffer);
      f.quality = assessFrame(f.pose, f.aspect);
    } else if (!(f.pose && now - this.lastSeenAt < TRACKING_CONFIG.holdLostMs)) {
      f.pose = null;
      f.quality = NO_BODY_QUALITY;
      this.primaryCenter = null;
      this.smoother.reset();
    }
    f.trackable = f.pose !== null && isTrackable(f.quality.status);

    // 3. Features → classification → state machines.
    const events: GestureEvent[] = [];
    if (f.trackable && f.pose) {
      f.features = extractFeatures(f.pose, f.baseline);
      if (f.baseline) {
        f.classification = classify(f.features, f.baseline.mode);
        const feats = summary(f.features);
        events.push(...this.lateralSM.update(f.classification, feats, now));
        events.push(...this.verticalSM.update(f.classification, feats, now));
        if (this.lateralSM.current.phase === 'NEUTRAL' && this.verticalSM.current.phase === 'NEUTRAL') {
          adaptBaselineDrift(f.baseline, f.features, dtSinceLast);
        }
      } else {
        f.classification = null;
      }
    } else {
      f.features = null;
      f.classification = null;
      events.push(...this.lateralSM.reset(now), ...this.verticalSM.reset(now));
    }
    f.lateral = this.lateralSM.current;
    f.vertical = this.verticalSM.current;

    // 4. Error diagnosis for whatever the current screen expects.
    if (f.expected && f.features && f.classification && f.baseline && f.pose) {
      f.diagnosis = diagnose(f.expected, f.features, f.classification, f.baseline, now);
      f.target = f.diagnosis.verdict === 'correct' ? null : buildTargetPose(f.pose, f.expected, f.baseline, this.targetBuffer);
    } else {
      f.diagnosis = null;
      f.target = null;
    }
    const hintChanged = this.hints.update(f.expected ? f.diagnosis : null, now);

    // 5. Lighting, sampled once per second.
    let lowLight = this.ui.get().lowLight;
    if (now - this.lastLightSampleAt >= TRACKING_CONFIG.lighting.sampleIntervalMs) {
      this.lastLightSampleAt = now;
      const luma = this.lightMeter.sample(video);
      if (luma !== null) lowLight = luma < TRACKING_CONFIG.lighting.lowLumaThreshold;
    }

    // 6. Publish low-frequency state, then events.
    const stableStatus = this.status.update(f.quality.status, now);
    this.ui.set({
      tracking: stableStatus,
      trackingMessage: trackingMessage({ ...f.quality, status: stableStatus }),
      lowHeadroom: f.quality.lowHeadroom,
      lowLight,
      lateral: this.lateralSM.confirmed,
      vertical: this.verticalSM.confirmed,
      ...(hintChanged ? { hint: this.hints.current } : {}),
    });
    this.emit(events);
  }

  private updateMultiPerson(othersPresent: boolean, now: number): void {
    const cfg = TRACKING_CONFIG.multiPerson;
    const current = this.ui.get().multiplePeople;
    if (othersPresent) {
      this.othersGoneSince = null;
      this.othersSince ??= now;
      if (!current && now - this.othersSince >= cfg.persistMs) this.ui.set({ multiplePeople: true });
    } else {
      this.othersSince = null;
      this.othersGoneSince ??= now;
      if (current && now - this.othersGoneSince >= cfg.clearMs) this.ui.set({ multiplePeople: false });
    }
  }

  private emit(events: GestureEvent[]): void {
    for (const event of events) {
      for (const listener of this.gestureListeners) listener(event);
    }
  }
}
