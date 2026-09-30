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
  /** 1 = one player (fast tracking), 2 = two players in one frame. */
  setNumPoses(numPoses: number): void;
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

  setNumPoses(numPoses: number): void {
    void this.core.setNumPoses(numPoses);
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
    // null = no answer for this frame (delegate switch) — keep the previous state.
    if (poses) callbacks.onResult({ poses, capturedAt, inferenceMs: performance.now() - started });
  }
}

function param(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

function workerAllowed(): boolean {
  if (!TRACKING_CONFIG.worker.enabled) return false;
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return false;
  return param('worker') !== '0';
}

/** Debug knobs for diagnosing a specific machine: ?delegate=cpu|gpu, ?frame=bitmap|videoframe. */
export interface BackendOverrides {
  delegate: Delegate | null;
  frame: 'bitmap' | 'videoframe' | null;
}

function overrides(): BackendOverrides {
  const d = param('delegate')?.toUpperCase();
  const f = param('frame');
  return {
    delegate: d === 'CPU' || d === 'GPU' ? d : null,
    frame: f === 'bitmap' || f === 'videoframe' ? f : null,
  };
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
      const knobs = overrides();
      if (workerAllowed()) {
        try {
          const backend = await WorkerPoseBackend.create(sources, !DEBUG, knobs);
          backend.onDead = () => {
            shared = null;
          };
          return backend;
        } catch {
          // Fall through to the main-thread backend.
        }
      }
      if (!DEBUG) installMediapipeLogFilter();
      return new MainThreadBackend(await LandmarkerCore.create(sources, false, knobs.delegate));
    })().catch((error: unknown) => {
      shared = null;
      throw error;
    });
  }
  return shared;
}
