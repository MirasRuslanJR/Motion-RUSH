import { FilesetResolver, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { TRACKING_CONFIG } from '../../config/tracking.config';

/**
 * DOM-free MediaPipe wrapper shared by the Web Worker and the main-thread
 * fallback. This is the ONLY code that talks to the library; its job ends at
 * "image → raw landmarks".
 */

export type Delegate = 'GPU' | 'CPU';

export interface AssetSource {
  wasm: string;
  model: string;
}

/**
 * The MediaPipe WASM runtime prints native glog lines ("W0928 … gl_context.cc",
 * "INFO: Created TensorFlow Lite XNNPACK delegate") to the console, some via
 * console.error. Hide only those INFO/WARNING-level lines; real errors (E-level)
 * and everything else pass through.
 */
const MEDIAPIPE_NOISE = /^(?:[IW]\d{4} \d|INFO: |Graph successfully started running)/;
let logFilterInstalled = false;

export function installMediapipeLogFilter(): void {
  if (logFilterInstalled) return;
  logFilterInstalled = true;
  for (const method of ['log', 'info', 'warn', 'error'] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && MEDIAPIPE_NOISE.test(args[0])) return;
      original(...args);
    };
  }
}

let moduleLoads = 0;

async function createLandmarker(source: AssetSource, delegate: Delegate, useModule: boolean): Promise<PoseLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(source.wasm, useModule);
  if (useModule) {
    // MediaPipe clears self.ModuleFactory after each init, and import() never re-runs a cached
    // module — so a second landmarker (GPU→CPU switch, fallbacks) needs a unique loader URL.
    // The .wasm binary URL is unchanged, so the compiled binary is still cached.
    const sep = fileset.wasmLoaderPath.includes('?') ? '&' : '?';
    fileset.wasmLoaderPath = `${fileset.wasmLoaderPath}${sep}load=${++moduleLoads}`;
  }
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
 * Robustness: sources are tried in order (local assets first, CDN fallback);
 * GPU delegate first with CPU fallback at creation AND at runtime.
 */
export class LandmarkerCore {
  private landmarker: PoseLandmarker;
  private readonly source: AssetSource;
  private readonly useModule: boolean;
  private currentDelegate: Delegate;
  private lastTimestamp = 0;
  private errors = 0;
  private switching = false;
  private readonly gpuTimings: number[] = [];
  private gpuVerified = false;

  private constructor(landmarker: PoseLandmarker, source: AssetSource, delegate: Delegate, useModule: boolean) {
    this.landmarker = landmarker;
    this.source = source;
    this.currentDelegate = delegate;
    this.useModule = useModule;
  }

  get delegate(): Delegate {
    return this.currentDelegate;
  }

  /** Consecutive failed detections (0 after any success). */
  get consecutiveErrors(): number {
    return this.errors;
  }

  static async create(sources: readonly AssetSource[], useModule: boolean): Promise<LandmarkerCore> {
    let lastError: unknown = null;
    for (const source of sources) {
      for (const delegate of ['GPU', 'CPU'] as const) {
        try {
          const landmarker = await createLandmarker(source, delegate, useModule);
          return new LandmarkerCore(landmarker, source, delegate, useModule);
        } catch (error) {
          lastError = error;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Pose model failed to load');
  }

  /**
   * Returns raw landmarks for every detected person (may be empty).
   * Transient failures return [] (and bump `consecutiveErrors`); a persistent
   * failure throws so the caller can surface a real error.
   */
  detect(image: TexImageSource, now: number): NormalizedLandmark[][] {
    if (this.switching) return [];
    // VIDEO mode requires strictly increasing timestamps.
    const timestamp = Math.max(now, this.lastTimestamp + 1);
    this.lastTimestamp = timestamp;
    const { maxConsecutiveErrors } = TRACKING_CONFIG.inference;
    try {
      const started = performance.now();
      const result = this.landmarker.detectForVideo(image, timestamp);
      this.errors = 0;
      if (this.currentDelegate === 'GPU') this.checkGpuSpeed(performance.now() - started);
      return result.landmarks;
    } catch (error) {
      this.errors++;
      if (this.errors >= maxConsecutiveErrors && this.currentDelegate === 'GPU') void this.switchToCpu();
      if (this.errors > maxConsecutiveErrors * 4) throw error;
      return [];
    }
  }

  /**
   * When Chrome blocklists the GPU, WebGL silently runs on a software
   * rasterizer and the GPU delegate becomes 10–50× slower than XNNPACK on CPU.
   * Detect that from real timings (skipping warm-up) and switch once.
   */
  private checkGpuSpeed(ms: number): void {
    if (this.gpuVerified) return;
    const { gpuWarmupFrames, gpuSampleFrames, slowGpuMs } = TRACKING_CONFIG.inference;
    this.gpuTimings.push(ms);
    if (this.gpuTimings.length < gpuWarmupFrames + gpuSampleFrames) return;
    const samples = this.gpuTimings.slice(gpuWarmupFrames).sort((a, b) => a - b);
    const median = samples[samples.length >> 1] ?? 0;
    this.gpuVerified = true;
    if (median > slowGpuMs) void this.switchToCpu();
  }

  private async switchToCpu(): Promise<void> {
    if (this.switching) return;
    this.switching = true;
    try {
      const next = await createLandmarker(this.source, 'CPU', this.useModule);
      this.landmarker.close();
      this.landmarker = next;
      this.currentDelegate = 'CPU';
      this.errors = 0;
    } catch {
      // Keep the current landmarker; errors will surface through detect().
    } finally {
      this.switching = false;
    }
  }
}
