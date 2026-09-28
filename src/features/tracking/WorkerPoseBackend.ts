import { TRACKING_CONFIG } from '../../config/tracking.config';
import type { RawLandmark } from './LandmarkNormalizer';
import type { AssetSource, Delegate } from './landmarkerCore';
import { unpackPoses } from './landmarkPacking';
import type { PoseBackend, PoseCallbacks } from './poseBackend';
import type { WorkerRequest, WorkerResponse } from './workerProtocol';

interface Pending {
  callbacks: PoseCallbacks;
  capturedAt: number;
  timer: number;
}

type Frame = VideoFrame | ImageBitmap;

/**
 * Main-thread proxy for pose.worker.ts. Grabs the current camera frame
 * (VideoFrame when supported — zero-copy — else ImageBitmap), transfers it to
 * the worker and delivers the unpacked landmarks. One frame in flight at a time,
 * so the inference rate self-adjusts to what the device can sustain.
 */
export class WorkerPoseBackend implements PoseBackend {
  readonly kind = 'worker' as const;
  /** Called if the worker dies, so the next load creates a fresh one. */
  onDead: (() => void) | null = null;
  private readonly worker: Worker;
  private currentDelegate: Delegate;
  private pending: Pending | null = null;
  private useVideoFrame = typeof VideoFrame !== 'undefined';
  private grabFailures = 0;
  private readonly pool: RawLandmark[][] = [];

  private constructor(worker: Worker, delegate: Delegate) {
    this.worker = worker;
    this.currentDelegate = delegate;
    worker.addEventListener('message', this.onMessage);
    worker.addEventListener('error', this.onWorkerError);
  }

  static create(sources: AssetSource[], filterLogs: boolean): Promise<WorkerPoseBackend> {
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
          resolve(new WorkerPoseBackend(worker, message.delegate));
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
      worker.postMessage({ type: 'init', sources, filterLogs } satisfies WorkerRequest);
    });
  }

  get delegate(): Delegate {
    return this.currentDelegate;
  }

  get busy(): boolean {
    return this.pending !== null;
  }

  submit(video: HTMLVideoElement, capturedAt: number, callbacks: PoseCallbacks): void {
    if (this.pending) return;
    const timer = window.setTimeout(() => this.clear(), TRACKING_CONFIG.worker.resultTimeoutMs);
    this.pending = { callbacks, capturedAt, timer };
    this.grab(video, capturedAt).then(
      (frame) => {
        this.grabFailures = 0;
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
      this.currentDelegate = message.delegate;
      if (message.inputRejected) this.useVideoFrame = false;
      // Ignore late answers for a frame that already timed out.
      if (!this.pending || this.pending.capturedAt !== message.timestamp) return;
      const pending = this.clear();
      pending?.callbacks.onResult({
        poses: unpackPoses(message.data, message.count, this.pool),
        capturedAt: message.timestamp,
        inferenceMs: message.inferenceMs,
      });
    } else if (message.type === 'fatal') {
      this.clear()?.callbacks.onError(new Error(message.message));
    }
  };

  private readonly onWorkerError = (event: ErrorEvent): void => {
    this.clear()?.callbacks.onError(new Error(event.message || 'Pose worker crashed'));
    this.onDead?.();
  };
}
