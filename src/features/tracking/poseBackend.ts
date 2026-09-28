import { TRACKING_CONFIG } from '../../config/tracking.config';
import { DEBUG } from '../../lib/env';
import type { RawLandmark } from './LandmarkNormalizer';
import { installMediapipeLogFilter, LandmarkerCore, type AssetSource, type Delegate } from './landmarkerCore';
import { WorkerPoseBackend } from './WorkerPoseBackend';

export interface PoseResult {
  poses: readonly (readonly RawLandmark[])[];
  /** Time the frame was captured (engine clock, ms). */
  capturedAt: number;
  inferenceMs: number;
}

export interface PoseCallbacks {
  onResult(result: PoseResult): void;
  onError(error: unknown): void;
}

/**
 * Where pose inference runs. The engine submits at most one frame at a time;
 * the worker backend answers asynchronously, the main-thread one synchronously.
 */
export interface PoseBackend {
  readonly kind: 'worker' | 'main';
  readonly delegate: Delegate;
  /** A frame is in flight — do not submit another one. */
  readonly busy: boolean;
  submit(video: HTMLVideoElement, capturedAt: number, callbacks: PoseCallbacks): void;
}

export function assetSources(): AssetSource[] {
  const base = new URL(import.meta.env.BASE_URL, window.location.href);
  return [
    { wasm: new URL('mediapipe/wasm', base).href, model: new URL(`models/${TRACKING_CONFIG.modelFile}`, base).href },
    { wasm: TRACKING_CONFIG.wasmCdnBase, model: TRACKING_CONFIG.modelCdnUrl },
  ];
}

/** Fallback: inference on the main thread (blocks rendering while it runs). */
class MainThreadBackend implements PoseBackend {
  readonly kind = 'main' as const;
  readonly busy = false;
  private readonly core: LandmarkerCore;

  constructor(core: LandmarkerCore) {
    this.core = core;
  }

  get delegate(): Delegate {
    return this.core.delegate;
  }

  submit(video: HTMLVideoElement, capturedAt: number, callbacks: PoseCallbacks): void {
    const started = performance.now();
    let poses;
    try {
      poses = this.core.detect(video, capturedAt);
    } catch (error) {
      callbacks.onError(error);
      return;
    }
    callbacks.onResult({ poses, capturedAt, inferenceMs: performance.now() - started });
  }
}

function workerAllowed(): boolean {
  if (!TRACKING_CONFIG.worker.enabled) return false;
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('worker') !== '0';
  } catch {
    return true;
  }
}

let shared: Promise<PoseBackend> | null = null;

/**
 * One backend per page, preloaded on the landing screen.
 * Worker first (keeps the main thread free for 60 fps rendering);
 * main thread if workers / OffscreenCanvas / module WASM are unavailable.
 */
export function loadPoseBackend(): Promise<PoseBackend> {
  if (!shared) {
    shared = (async (): Promise<PoseBackend> => {
      const sources = assetSources();
      if (workerAllowed()) {
        try {
          const backend = await WorkerPoseBackend.create(sources, !DEBUG);
          backend.onDead = () => {
            shared = null;
          };
          return backend;
        } catch {
          // Fall through to the main-thread backend.
        }
      }
      if (!DEBUG) installMediapipeLogFilter();
      return new MainThreadBackend(await LandmarkerCore.create(sources, false));
    })().catch((error: unknown) => {
      shared = null;
      throw error;
    });
  }
  return shared;
}
