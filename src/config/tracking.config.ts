/**
 * Camera + pose-tracking configuration.
 * Distances are in FRAME UNITS (1 = frame height) unless stated otherwise.
 */
export const TRACKING_CONFIG = {
  mediapipeVersion: '1.0.1',
  modelFile: 'pose_landmarker_lite.task',
  modelCdnUrl:
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
  wasmCdnBase: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm',

  /**
   * One pose: MediaPipe then tracks the same person frame to frame and mostly skips
   * the person detector — ~35% faster inference than numPoses: 2 on integrated GPUs.
   * Set to 2 to re-enable the "one player only" warning (poseSelection handles it).
   */
  numPoses: 1,
  minPoseDetectionConfidence: 0.5,
  /**
   * Stricter than MediaPipe's 0.5 defaults: after a fast move (a real jump, a
   * quick step) a weak track is dropped and the person is detected afresh,
   * instead of the skeleton sliding off the body.
   */
  minPosePresenceConfidence: 0.6,
  minTrackingConfidence: 0.6,

  camera: {
    idealWidth: 640,
    idealHeight: 480,
    idealFps: 30,
    /**
     * Two-player modes ask for a 16:9 picture: laptop cameras are mostly 16:9,
     * and a 640×480 request makes the browser cut a quarter of the width off.
     */
    wide: { idealWidth: 960, idealHeight: 540 },
  },

  inference: {
    /** Upper bound for pose inference rate. Rendering always runs at display rate. */
    maxFps: 30,
    /** Lower bound when the device is slow. */
    minFps: 12,
    /** If average inference time exceeds this share of the frame budget, back off. */
    loadFactor: 0.6,
    /** Consecutive failures before switching GPU → CPU. */
    maxConsecutiveErrors: 4,
    /** GPU timing check: ignore warm-up frames, then judge the median of the next N. */
    gpuWarmupFrames: 5,
    gpuSampleFrames: 10,
    /** Median GPU inference above this (software WebGL) → switch to the CPU delegate. */
    slowGpuMs: 70,
  },

  worker: {
    /** Run MediaPipe in a Web Worker so inference never blocks rendering. */
    enabled: true,
    /** Model download + init budget before falling back to the main thread. */
    initTimeoutMs: 45000,
    /**
     * Safety net only: the worker answers every frame (even "skipped"), and the
     * first GPU inference can take seconds while shaders compile. A short timeout
     * would just queue more frames behind that warm-up.
     */
    resultTimeoutMs: 10000,
    /**
     * Delegate inside the worker. CPU: smooth from the first second. The GPU delegate
     * compiles shaders on first use (10+ s on integrated GPUs) and stalls the page
     * meanwhile. Override per session with ?delegate=gpu.
     */
    delegate: 'CPU' as 'CPU' | 'GPU',
  },

  /** Keep the last pose this long when landmarks drop out for a moment. */
  holdLostMs: 320,
  /** Tracking-status changes must persist this long before the UI reacts (anti-flicker). */
  statusDebounceMs: 260,

  smoothing: {
    landmarks: { minCutoff: 1.4, beta: 3.0, dCutoff: 1.0 },
    /**
     * Slow recognition (a busy laptop, a video call next to the game): with few
     * frames per move the usual filter cuts a short jump by a third. Lighter
     * smoothing then — the low frame rate already smooths enough.
     */
    slowLandmarks: { minCutoff: 4.0, beta: 3.0, dCutoff: 1.0 },
    /** Average time between results that switches to the slow tuning, and back. */
    slowEnterMs: 130,
    slowExitMs: 100,
    visibilityTauMs: 120,
  },

  quality: {
    /** Shoulders + nose must be at least this visible to use the frame. */
    minCoreVisibility: 0.55,
    minHipVisibility: 0.55,
    minWristVisibility: 0.4,
    /** Shoulder width (frame units) below which the user is too far. */
    tooFarShoulderWidth: 0.07,
    /** Shoulder width above which the user is too close for arm gestures. */
    tooCloseShoulderWidth: 0.42,
    /** Shoulder centre must stay inside [margin, 1 - margin] of the frame width. */
    centerMargin: 0.12,
    /** Space needed above the shoulder line for raised hands, in shoulder widths. */
    headroomShoulderWidths: 1.5,
  },

  multiPerson: {
    /** A second pose counts only if it is at least this big relative to the player. */
    minRelativeScale: 0.55,
    minVisibility: 0.6,
    /** A "second" pose whose shoulders are this close (in player shoulder widths) is a duplicate of the player. */
    duplicateDistance: 0.9,
    persistMs: 700,
    clearMs: 600,
  },

  lighting: {
    sampleIntervalMs: 1000,
    /** Mean frame luma (0-255) below this is "too dark". */
    lowLumaThreshold: 48,
  },
} as const;
