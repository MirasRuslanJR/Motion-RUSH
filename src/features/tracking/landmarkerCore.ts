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

/**
 * True when WebGL is rendered in software (GPU blocklisted, VMs, remote desktop):
 * the MediaPipe GPU delegate then needs ~10 s to warm up and runs slower than
 * the CPU delegate, so we start on CPU directly. Works in workers and on the main thread.
 */
export function isSoftwareWebGL(): boolean {
  try {
    const canvas: OffscreenCanvas | HTMLCanvasElement =
      typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
    if (!gl) return true;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
  } catch {
    return false;
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
  private readonly pinned: boolean;
  private numPoses: number = TRACKING_CONFIG.numPoses;

  private constructor(landmarker: PoseLandmarker, source: AssetSource, delegate: Delegate, useModule: boolean, pinned: boolean) {
    this.landmarker = landmarker;
    this.source = source;
    this.currentDelegate = delegate;
    this.useModule = useModule;
    // A pinned delegate (explicitly requested) is never switched automatically.
    this.pinned = pinned;
    this.gpuVerified = pinned;
  }

  get delegate(): Delegate {
    return this.currentDelegate;
  }

  /** 1 = single player (fast), 2 = two players in front of one camera. */
  async setNumPoses(numPoses: number): Promise<void> {
    if (numPoses === this.numPoses) return;
    this.numPoses = numPoses;
    try {
      await this.landmarker.setOptions({ numPoses });
    } catch {
      // Keep the previous setting.
    }
  }

  /** Consecutive failed detections (0 after any success). */
  get consecutiveErrors(): number {
    return this.errors;
  }

  /** `forced` pins the delegate (debug: ?delegate=cpu|gpu). */
  static async create(sources: readonly AssetSource[], useModule: boolean, forced: Delegate | null = null): Promise<LandmarkerCore> {
    const delegates: readonly Delegate[] = forced ? [forced] : isSoftwareWebGL() ? ['CPU'] : ['GPU', 'CPU'];
    let lastError: unknown = null;
    for (const source of sources) {
      for (const delegate of delegates) {
        try {
          const landmarker = await createLandmarker(source, delegate, useModule);
          return new LandmarkerCore(landmarker, source, delegate, useModule, forced !== null);
        } catch (error) {
          lastError = error;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Pose model failed to load');
  }

  /**
   * Returns raw landmarks for every detected person ([] = nobody in frame),
   * or null when there is no answer for this frame (delegate switch in progress,
   * transient failure) — callers must not treat that as "nobody there".
   * A persistent failure throws so the caller can surface a real error.
   */
  detect(image: TexImageSource, now: number): NormalizedLandmark[][] | null {
    if (this.switching) return null;
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
      if (this.errors >= maxConsecutiveErrors && this.currentDelegate === 'GPU' && !this.pinned) void this.switchToCpu();
      if (this.errors > maxConsecutiveErrors * 4) throw error;
      return null;
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
      if (this.numPoses !== TRACKING_CONFIG.numPoses) await next.setOptions({ numPoses: this.numPoses });
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
