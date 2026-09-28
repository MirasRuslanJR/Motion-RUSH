import { FilesetResolver, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { TRACKING_CONFIG } from '../../config/tracking.config';

export type Delegate = 'GPU' | 'CPU';

interface AssetSource {
  wasm: string;
  model: string;
}

function localSource(): AssetSource {
  const base = new URL(import.meta.env.BASE_URL, window.location.href);
  return {
    wasm: new URL('mediapipe/wasm', base).href,
    model: new URL(`models/${TRACKING_CONFIG.modelFile}`, base).href,
  };
}

const CDN_SOURCE: AssetSource = { wasm: TRACKING_CONFIG.wasmCdnBase, model: TRACKING_CONFIG.modelCdnUrl };

async function createLandmarker(source: AssetSource, delegate: Delegate): Promise<PoseLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(source.wasm);
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: source.model, delegate },
    runningMode: 'VIDEO',
    numPoses: TRACKING_CONFIG.numPoses,
    minPoseDetectionConfidence: TRACKING_CONFIG.minPoseDetectionConfidence,
    minPosePresenceConfidence: TRACKING_CONFIG.minPosePresenceConfidence,
    minTrackingConfidence: TRACKING_CONFIG.minTrackingConfidence,
    outputSegmentationMasks: false,
  });
}

/**
 * Thin wrapper around MediaPipe PoseLandmarker — the ONLY place that knows
 * about the library. Its job ends at "video frame → raw landmarks".
 *
 * Robustness: local assets first (no CDN dependency), CDN as a fallback;
 * GPU delegate first, CPU fallback at creation AND at runtime.
 */
export class PoseTracker {
  private landmarker: PoseLandmarker;
  private source: AssetSource;
  private currentDelegate: Delegate;
  private lastTimestamp = 0;
  private consecutiveErrors = 0;
  private switching = false;

  private constructor(landmarker: PoseLandmarker, source: AssetSource, delegate: Delegate) {
    this.landmarker = landmarker;
    this.source = source;
    this.currentDelegate = delegate;
  }

  get delegate(): Delegate {
    return this.currentDelegate;
  }

  static async create(): Promise<PoseTracker> {
    const attempts: Array<[AssetSource, Delegate]> = [
      [localSource(), 'GPU'],
      [localSource(), 'CPU'],
      [CDN_SOURCE, 'GPU'],
      [CDN_SOURCE, 'CPU'],
    ];
    let lastError: unknown = null;
    for (const [source, delegate] of attempts) {
      try {
        const landmarker = await createLandmarker(source, delegate);
        return new PoseTracker(landmarker, source, delegate);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Pose model failed to load');
  }

  /** Returns raw landmarks for every detected person (may be empty). */
  detect(video: HTMLVideoElement, now: number): NormalizedLandmark[][] {
    if (this.switching) return [];
    // VIDEO mode requires strictly increasing timestamps.
    const timestamp = Math.max(now, this.lastTimestamp + 1);
    this.lastTimestamp = timestamp;
    try {
      const result = this.landmarker.detectForVideo(video, timestamp);
      this.consecutiveErrors = 0;
      return result.landmarks;
    } catch (error) {
      this.consecutiveErrors++;
      if (this.consecutiveErrors >= TRACKING_CONFIG.inference.maxConsecutiveErrors && this.currentDelegate === 'GPU') {
        void this.switchToCpu();
      }
      if (this.consecutiveErrors > TRACKING_CONFIG.inference.maxConsecutiveErrors * 4) throw error;
      return [];
    }
  }

  private async switchToCpu(): Promise<void> {
    this.switching = true;
    try {
      const next = await createLandmarker(this.source, 'CPU');
      this.landmarker.close();
      this.landmarker = next;
      this.currentDelegate = 'CPU';
      this.consecutiveErrors = 0;
    } finally {
      this.switching = false;
    }
  }
}

let shared: Promise<PoseTracker> | null = null;

/**
 * One tracker per page. Called early (landing screen) to preload the model
 * while the user reads the intro; a failed load can be retried.
 */
export function loadPoseTracker(): Promise<PoseTracker> {
  if (!shared) {
    shared = PoseTracker.create().catch((error: unknown) => {
      shared = null;
      throw error;
    });
  }
  return shared;
}
