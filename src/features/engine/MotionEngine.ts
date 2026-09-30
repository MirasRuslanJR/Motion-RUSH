import { RENDER_CONFIG, type QualityLevel, type QualitySettings } from '../../config/render.config';
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
import { schemeOf, type ControlScheme, type ExpectedMotion, type GestureEvent, type GestureEventFeatures, type GestureType } from '../gestures/types';
import { assessFrame, isTrackable, NO_BODY_QUALITY, trackingMessage, type FrameQuality, type TrackingStatus } from '../tracking/frameQuality';
import { normalizeLandmarks } from '../tracking/LandmarkNormalizer';
import { copyPoseInto, createPose, type Pose } from '../tracking/landmarks';
import type { Delegate } from '../tracking/landmarkerCore';
import { QualityGovernor } from '../render/quality';
import { MotionSmoother } from '../tracking/MotionSmoother';
import { loadPoseBackend, type PoseBackend, type PoseCallbacks, type PoseResult } from '../tracking/poseBackend';
import { selectPrimaryPose } from '../tracking/poseSelection';

/** Low-frequency state for React. Changes a few times per second at most. */
export interface MotionUiState {
  camera: 'idle' | 'starting' | 'live' | 'error';
  cameraError: CameraErrorKind | null;
  model: 'loading' | 'ready' | 'error';
  delegate: Delegate | null;
  /** Where inference runs: a Web Worker (preferred) or the main thread. */
  backend: PoseBackend['kind'] | null;
  /** Control scheme chosen by calibration: whole body (standing) or seated. */
  scheme: ControlScheme;
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
  /** Latest recognised pose (updates at the inference rate) — used by all logic. */
  pose: Pose | null;
  /** The same pose eased every display frame — for drawing only. */
  displayPose: Pose | null;
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
  /**
   * Every detected person (normalised, mirrored), sorted left → right on screen.
   * Filled only in two-player mode (see setPlayers); otherwise empty.
   */
  people: Pose[];
  /** Adaptive rendering quality for this frame (see QualityGovernor). */
  render: QualitySettings;
  renderLevel: QualityLevel;
  stats: { fps: number; inferenceFps: number; inferenceMs: number; targetInferenceFps: number };
}

export type FrameListener = (frame: Readonly<MotionFrame>, dtMs: number) => void;
export type GestureListener = (event: GestureEvent) => void;

const INITIAL_UI: MotionUiState = {
  camera: 'idle',
  cameraError: null,
  model: 'loading',
  delegate: null,
  backend: null,
  scheme: 'body',
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
 *   CameraSource → PoseBackend (Web Worker) → LandmarkNormalizer → MotionSmoother
 *     → FeatureExtractor → GestureClassifier → GestureStateMachine (×2 channels)
 *     → ErrorDiagnosisEngine → listeners (game, renderers) / Store (React)
 *
 * Runs its own requestAnimationFrame loop. Frames are handed to the pose
 * backend (one in flight, ≤ 30 Hz); results are processed when they arrive,
 * while rendering listeners run every display frame.
 */
export class MotionEngine {
  readonly ui = new Store<MotionUiState>(INITIAL_UI);
  readonly frame: MotionFrame;
  private readonly quality = new QualityGovernor();

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
  private readonly displayBuffer = createPose();
  private readonly targetBuffer = createPose();
  private readonly status = new Debounced<TrackingStatus>('NO_BODY', TRACKING_CONFIG.statusDebounceMs);
  private readonly fpsMeter = new RateMeter();
  private readonly inferenceMeter = new RateMeter();

  private backend: PoseBackend | null = null;
  private readonly callbacks: PoseCallbacks = {
    onResult: (result) => this.processPoses(result),
    onError: () => {
      if (!this.disposed) this.ui.set({ model: 'error', camera: 'error', cameraError: 'model' });
    },
  };
  private raf = 0;
  private lastTick = 0;
  private lastInferenceAt = 0;
  private lastProcessedAt = 0;
  /** A pose result was processed since the previous animation frame. */
  private resultArrived = false;
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
  private players = 1;
  private readonly peopleBuffers: Pose[] = [createPose(), createPose()];

  constructor() {
    this.frame = {
      time: 0,
      inferred: false,
      aspect: 4 / 3,
      videoWidth: 0,
      videoHeight: 0,
      pose: null,
      displayPose: null,
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
      people: [],
      render: this.quality.settings,
      renderLevel: this.quality.level,
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
      const backend = await loadPoseBackend();
      if (this.disposed) return;
      this.backend = backend;
      if (this.players !== 1) backend.setNumPoses(this.players);
      this.ui.set({ model: 'ready', delegate: backend.delegate, backend: backend.kind });
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
          // Lanes (body scheme) are parts of the whole picture unless a screen narrows it.
          region: baseline.region ? { ...baseline.region } : { x0: 0, x1: this.frame.aspect },
        }
      : null;
    if (baseline) this.ui.set({ scheme: schemeOf(baseline.mode) });
    this.emit([...this.lateralSM.reset(this.frame.time), ...this.verticalSM.reset(this.frame.time)]);
  }

  /** 2 = two players share the camera (left / right half). Detecting two people is slower. */
  setPlayers(players: 1 | 2): void {
    if (players === this.players) return;
    this.players = players;
    this.backend?.setNumPoses(players);
    this.frame.people = [];
    this.ui.set({ multiplePeople: false });
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
    const frameMs = this.lastTick ? now - this.lastTick : 16;
    // Clamp so a long stall (tab switch, GC) cannot teleport the game forward.
    const dt = Math.min(frameMs, 250);
    this.lastTick = now;
    this.fpsMeter.tick(now);
    if (this.quality.update(frameMs)) {
      this.frame.render = this.quality.settings;
      this.frame.renderLevel = this.quality.level;
    }

    this.frame.time = now;
    if (this.shouldInfer(now)) this.requestInference(now);
    // Worker results arrive between frames; the main-thread backend answers inside requestInference.
    this.frame.inferred = this.resultArrived;
    this.resultArrived = false;
    this.easeDisplayPose(dt);

    this.frame.stats.fps = this.fpsMeter.rate;
    for (const listener of this.frameListeners) listener(this.frame, dt);
  };

  /** Glide the drawn pose toward the latest recognised one (frame-rate independent). */
  private easeDisplayPose(dt: number): void {
    const f = this.frame;
    const target = f.pose;
    if (!target) {
      f.displayPose = null;
      return;
    }
    const display = this.displayBuffer;
    if (!f.displayPose) {
      copyPoseInto(target, display);
      f.displayPose = display;
      return;
    }
    const a = 1 - Math.exp(-dt / RENDER_CONFIG.displaySmoothingMs);
    for (let i = 0; i < target.length; i++) {
      const t = target[i];
      const d = display[i];
      if (!t || !d) continue;
      d.x += (t.x - d.x) * a;
      d.y += (t.y - d.y) * a;
      d.z = t.z;
      d.v = t.v;
    }
  }

  private shouldInfer(now: number): boolean {
    const video = this.camera.video;
    if (!this.backend || this.backend.busy || video.readyState < 2 || video.videoWidth === 0) return false;
    if (video.currentTime === this.lastVideoTime) return false;
    return now - this.lastInferenceAt >= 1000 / this.targetFps - 2;
  }

  private requestInference(now: number): void {
    const video = this.camera.video;
    this.lastInferenceAt = now;
    this.lastVideoTime = video.currentTime;
    this.backend?.submit(video, now, this.callbacks);
  }

  /**
   * Only the main-thread backend competes with rendering, so only it backs off.
   * The worker backend is naturally limited to one frame in flight.
   */
  private adaptInferenceRate(now: number, ms: number): void {
    this.avgInferenceMs = this.avgInferenceMs === 0 ? ms : this.avgInferenceMs * 0.9 + ms * 0.1;
    if (this.backend?.kind !== 'main' || now - this.lastRateChangeAt < 500) return;
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

  /** Everything after inference: cheap (< 1 ms), always on the main thread. */
  private processPoses(result: PoseResult): void {
    if (this.disposed) return;
    const { poses } = result;
    // Timestamps come from frame capture, so smoothing and state timing stay exact
    // even when a worker answers a few milliseconds later.
    const now = result.capturedAt;
    const video = this.camera.video;
    const dtSinceLast = this.lastProcessedAt ? now - this.lastProcessedAt : 33;
    this.lastProcessedAt = now;
    this.adaptInferenceRate(now, result.inferenceMs);
    this.inferenceMeter.tick(performance.now());
    this.resultArrived = true;

    const f = this.frame;
    f.videoWidth = video.videoWidth;
    f.videoHeight = video.videoHeight;
    f.aspect = video.videoWidth / video.videoHeight;
    f.stats.inferenceMs = this.avgInferenceMs;
    f.stats.inferenceFps = this.inferenceMeter.rate;
    f.stats.targetInferenceFps = this.targetFps;

    // 1. Pick the player, track bystanders (in two-player mode everybody is a player).
    const selection = selectPrimaryPose(poses, f.aspect, this.primaryCenter);
    this.updateMultiPerson(this.players === 1 && selection.significantOthers > 0, now);
    if (this.players > 1) {
      const people: Pose[] = [];
      for (let i = 0; i < poses.length && i < this.peopleBuffers.length; i++) {
        const raw = poses[i];
        const buffer = this.peopleBuffers[i];
        if (raw && buffer) people.push(normalizeLandmarks(raw, f.aspect, true, buffer));
      }
      const centerX = (p: Pose) => ((p[11]?.x ?? 0) + (p[12]?.x ?? 0)) / 2;
      f.people = people.sort((a, b) => centerX(a) - centerX(b));
    }

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
      delegate: this.backend?.delegate ?? null,
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
