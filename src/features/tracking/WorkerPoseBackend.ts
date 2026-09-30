import { TRACKING_CONFIG } from '../../config/tracking.config';
import type { RawLandmark } from './LandmarkNormalizer';
import type { AssetSource, Delegate } from './landmarkerCore';
import { unpackPoses } from './landmarkPacking';
import type { BackendOverrides, PoseBackend, PoseCallbacks } from './poseBackend';
import type { WorkerRequest, WorkerResponse } from './workerProtocol';

type Frame = VideoFrame | ImageBitmap;
type ResultMessage = Extract<WorkerResponse, { type: 'result' }>;

interface Pending {
  capturedAt: number;
  timer: number;
  onResult: (message: ResultMessage) => void;
  onError: (error: Error) => void;
}

/**
 * One pose worker: grabs the current camera frame (VideoFrame when supported —
 * zero-copy — else ImageBitmap), transfers it, and routes the answer back.
 * At most one frame in flight, so the rate self-adjusts to the device.
 */
class WorkerChannel {
  readonly worker: Worker;
  delegate: Delegate;
  private pending: Pending | null = null;
  private useVideoFrame = typeof VideoFrame !== 'undefined';
  private grabFailures = 0;
  private dead = false;
  onDead: (() => void) | null = null;

  private constructor(worker: Worker, delegate: Delegate, frame: BackendOverrides['frame']) {
    this.worker = worker;
    this.delegate = delegate;
    if (frame) this.useVideoFrame = frame === 'videoframe' && typeof VideoFrame !== 'undefined';
    worker.addEventListener('message', this.onMessage);
    worker.addEventListener('error', this.onWorkerError);
  }

  static create(
    sources: AssetSource[],
    filterLogs: boolean,
    delegate: Delegate | null,
    frame: BackendOverrides['frame'],
  ): Promise<WorkerChannel> {
    const worker = new Worker(new URL('./pose.worker.ts', import.meta.url), { type: 'module', name: 'pose' });
    return new Promise((resolve, reject) => {
      const fail = (error: Error) => {
        cleanup();
        worker.terminate();
        reject(error);
      };
      const onMessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;
        if (message.type === 'ready') {
          cleanup();
          resolve(new WorkerChannel(worker, message.delegate, frame));
        } else if (message.type === 'init-error') {
          fail(new Error(message.message));
        }
      };
      const onError = (event: ErrorEvent) => fail(new Error(event.message || 'Pose worker failed to start'));
      const timer = window.setTimeout(() => fail(new Error('Pose worker init timeout')), TRACKING_CONFIG.worker.initTimeoutMs);
      const cleanup = () => {
        window.clearTimeout(timer);
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.postMessage({ type: 'init', sources, filterLogs, delegate } satisfies WorkerRequest);
    });
  }

  get busy(): boolean {
    return this.pending !== null;
  }

  send(video: HTMLVideoElement, capturedAt: number, onResult: Pending['onResult'], onError: Pending['onError']): void {
    if (this.pending || this.dead) return;
    const timer = window.setTimeout(() => this.clear(), TRACKING_CONFIG.worker.resultTimeoutMs);
    this.pending = { capturedAt, timer, onResult, onError };
    this.grab(video, capturedAt).then(
      (frame) => {
        this.grabFailures = 0;
        if (this.dead) {
          frame.close();
          return;
        }
        try {
          this.worker.postMessage({ type: 'frame', frame, timestamp: capturedAt } satisfies WorkerRequest, [frame]);
        } catch {
          // This browser cannot transfer this frame type — fall back to ImageBitmap.
          frame.close();
          this.useVideoFrame = false;
          this.clear();
        }
      },
      () => {
        // No decodable frame right now (e.g. video just resized) — skip this tick.
        if (++this.grabFailures >= 3) this.useVideoFrame = false;
        this.clear();
      },
    );
  }

  setNumPoses(numPoses: number): void {
    if (!this.dead) this.worker.postMessage({ type: 'options', numPoses } satisfies WorkerRequest);
  }

  terminate(): void {
    this.dead = true;
    this.clear();
    this.worker.terminate();
  }

  private grab(video: HTMLVideoElement, capturedAt: number): Promise<Frame> {
    if (this.useVideoFrame) {
      try {
        return Promise.resolve(new VideoFrame(video, { timestamp: Math.round(capturedAt * 1000) }));
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return createImageBitmap(video);
  }

  private clear(): Pending | null {
    const pending = this.pending;
    if (pending) window.clearTimeout(pending.timer);
    this.pending = null;
    return pending;
  }

  private readonly onMessage = (event: MessageEvent<WorkerResponse>): void => {
    const message = event.data;
    if (message.type === 'result') {
      this.delegate = message.delegate;
      if (message.inputRejected) this.useVideoFrame = false;
      // Ignore late answers for a frame that already timed out.
      if (!this.pending || this.pending.capturedAt !== message.timestamp) return;
      this.clear()?.onResult(message);
    } else if (message.type === 'fatal') {
      this.clear()?.onError(new Error(message.message));
    }
  };

  private readonly onWorkerError = (event: ErrorEvent): void => {
    this.dead = true;
    this.clear()?.onError(new Error(event.message || 'Pose worker crashed'));
    this.onDead?.();
  };
}

/**
 * Pose inference in a Web Worker — the main thread only grabs frames and reads
 * results, so rendering stays smooth whatever the inference costs.
 *
 * The worker uses the CPU (XNNPACK) delegate by default. Measured on an
 * integrated Intel GPU: the GPU delegate is ~30% faster once warm, but its
 * first inference compiles shaders for 10+ s, and that compilation stalls
 * Chrome's GPU process — the whole page drops to ~10 fps meanwhile. CPU gives
 * smooth 60 fps from the first second. `?delegate=gpu` opts into the GPU.
 */
export class WorkerPoseBackend implements PoseBackend {
  readonly kind = 'worker' as const;
  /** Called if the worker dies, so the next load creates a fresh one. */
  onDead: (() => void) | null = null;
  private readonly channel: WorkerChannel;
  private readonly pool: RawLandmark[][] = [];

  private constructor(channel: WorkerChannel) {
    this.channel = channel;
    channel.onDead = () => this.onDead?.();
  }

  static async create(sources: AssetSource[], filterLogs: boolean, overrides: BackendOverrides): Promise<WorkerPoseBackend> {
    const delegate = overrides.delegate ?? TRACKING_CONFIG.worker.delegate;
    return new WorkerPoseBackend(await WorkerChannel.create(sources, filterLogs, delegate, overrides.frame));
  }

  get delegate(): Delegate {
    return this.channel.delegate;
  }

  get busy(): boolean {
    return this.channel.busy;
  }

  setNumPoses(numPoses: number): void {
    this.channel.setNumPoses(numPoses);
  }

  submit(video: HTMLVideoElement, capturedAt: number, callbacks: PoseCallbacks): void {
    this.channel.send(
      video,
      capturedAt,
      (message) => {
        // "No answer" (warm-up / delegate switch) keeps the previous tracking state.
        if (message.skipped) return;
        callbacks.onResult({
          poses: unpackPoses(message.data, message.count, this.pool),
          capturedAt: message.timestamp,
          inferenceMs: message.inferenceMs,
        });
      },
      (error) => callbacks.onError(error),
    );
  }
}
