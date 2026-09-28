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

  /** Detect up to 2 people so we can warn "one player only" instead of silently switching. */
  numPoses: 2,
  minPoseDetectionConfidence: 0.5,
  minPosePresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,

  camera: { idealWidth: 640, idealHeight: 480, idealFps: 30 },

  inference: {
    /** Upper bound for pose inference rate. Rendering always runs at display rate. */
    maxFps: 30,
    /** Lower bound when the device is slow. */
    minFps: 12,
    /** If average inference time exceeds this share of the frame budget, back off. */
    loadFactor: 0.6,
    /** Consecutive failures before switching GPU → CPU. */
    maxConsecutiveErrors: 4,
  },

  /** Keep the last pose this long when landmarks drop out for a moment. */
  holdLostMs: 320,
  /** Tracking-status changes must persist this long before the UI reacts (anti-flicker). */
  statusDebounceMs: 260,

  smoothing: {
    landmarks: { minCutoff: 1.4, beta: 3.0, dCutoff: 1.0 },
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
    persistMs: 700,
    clearMs: 600,
  },

  lighting: {
    sampleIntervalMs: 1000,
    /** Mean frame luma (0-255) below this is "too dark". */
    lowLumaThreshold: 48,
  },
} as const;
