import { installMediapipeLogFilter, LandmarkerCore } from './landmarkerCore';
import type { RawLandmark } from './LandmarkNormalizer';
import { packPoses } from './landmarkPacking';
import { assignSides, cropToFrame, splitCrops, type TwoPlayerTracking } from './splitTracking';
import type { WorkerRequest, WorkerResponse } from './workerProtocol';

/**
 * Pose inference off the main thread: MediaPipe runs here (WASM + WebGL on an
 * OffscreenCanvas), so a 15–50 ms inference never blocks rendering or input.
 *
 * Two-player mode cuts every frame into two crops and runs a separate
 * single-person tracker on each (see splitTracking.ts).
 */

interface WorkerScope {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
}

type InitMessage = Extract<WorkerRequest, { type: 'init' }>;
type Frame = VideoFrame | ImageBitmap;

const scope = self as unknown as WorkerScope;
let initMessage: InitMessage | null = null;
/** Full-frame tracker; in two-player mode it tracks P1's crop. */
let core: LandmarkerCore | null = null;
/** P2's tracker, created the first time two-player mode is used. */
let second: LandmarkerCore | null = null;
let secondLoading: Promise<void> | null = null;
let splitWanted = false;
/** The second tracker could not be created: one tracker looks for two people. */
let shared = false;
const cropCanvases: OffscreenCanvas[] = [];

async function init(message: InitMessage): Promise<void> {
  initMessage = message;
  if (message.filterLogs) installMediapipeLogFilter();
  try {
    // useModule = true: in a module worker the bundle loads the ES-module WASM loader via import().
    core = await LandmarkerCore.create(message.sources, true, message.delegate);
    scope.postMessage({ type: 'ready', delegate: core.delegate });
  } catch (error) {
    scope.postMessage({ type: 'init-error', message: error instanceof Error ? error.message : String(error) });
  }
}

function setSplit(enabled: boolean): void {
  splitWanted = enabled;
  if (!enabled) {
    if (shared) void core?.setNumPoses(1);
    return;
  }
  if (shared) void core?.setNumPoses(2);
  if (second || secondLoading || !initMessage) return;
  // Same delegate as the main tracker, so both behave the same.
  secondLoading = LandmarkerCore.create(initMessage.sources, true, core?.delegate ?? initMessage.delegate)
    .then(
      (created) => {
        second = created;
        if (shared) {
          shared = false;
          void core?.setNumPoses(1);
        }
      },
      () => {
        shared = true;
        if (splitWanted) void core?.setNumPoses(2);
      },
    )
    .finally(() => {
      secondLoading = null;
    });
}

function splitState(): TwoPlayerTracking {
  if (!splitWanted) return 'off';
  if (second) return 'split';
  return shared ? 'shared' : 'loading';
}

function cropCanvas(slot: number, width: number, height: number): OffscreenCanvas {
  let canvas = cropCanvases[slot];
  if (!canvas) {
    canvas = new OffscreenCanvas(width, height);
    cropCanvases[slot] = canvas;
  } else if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return canvas;
}

/** One single-person tracker per crop. Returns null when neither tracker answered. */
function detectSplit(frame: Frame, timestamp: number, trackers: readonly LandmarkerCore[]): { poses: RawLandmark[][]; slots: number[] } | null {
  const width = 'displayWidth' in frame ? frame.displayWidth : frame.width;
  const height = 'displayHeight' in frame ? frame.displayHeight : frame.height;
  const crops = splitCrops(width);
  const found: (RawLandmark[] | null)[] = [null, null];
  let answered = false;
  for (let slot = 0; slot < 2; slot++) {
    const crop = crops[slot];
    const tracker = trackers[slot];
    if (!crop || !tracker) continue;
    const canvas = cropCanvas(slot, crop.width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    ctx.drawImage(frame, crop.x0, 0, crop.width, height, 0, 0, crop.width, height);
    const result = tracker.detect(canvas, timestamp);
    if (result === null) continue;
    answered = true;
    const person = result[0];
    if (person) {
      const copy = person.map((l) => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility }));
      found[slot] = cropToFrame(copy, crop, width);
    }
  }
  if (!answered) return null;
  const [p1, p2] = assignSides(found[0] ?? null, found[1] ?? null);
  const poses: RawLandmark[][] = [];
  const slots: number[] = [];
  if (p1) {
    poses.push(p1);
    slots.push(0);
  }
  if (p2) {
    poses.push(p2);
    slots.push(1);
  }
  return { poses, slots };
}

function detect(message: Extract<WorkerRequest, { type: 'frame' }>): void {
  const { frame, timestamp } = message;
  try {
    const started = performance.now();
    const state = splitState();
    let poses: readonly (readonly RawLandmark[])[] | null = null;
    let slots: number[] | undefined;
    if (state === 'split' && core && second) {
      const result = detectSplit(frame, timestamp, [core, second]);
      if (result) {
        poses = result.poses;
        slots = result.slots;
      }
    } else if (core) {
      poses = core.detect(frame, timestamp);
    }
    const inferenceMs = performance.now() - started;
    const data = packPoses(poses ?? []);
    scope.postMessage(
      {
        type: 'result',
        data,
        count: poses?.length ?? 0,
        timestamp,
        inferenceMs,
        delegate: core?.delegate ?? 'CPU',
        skipped: poses === null,
        inputRejected:
          (core?.consecutiveErrors ?? 0) > 0 && typeof VideoFrame !== 'undefined' && frame instanceof VideoFrame,
        slots,
        split: state,
      },
      [data.buffer],
    );
  } catch (error) {
    scope.postMessage({ type: 'fatal', message: error instanceof Error ? error.message : String(error) });
  } finally {
    frame.close();
  }
}

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'init') void init(message);
  else if (message.type === 'split') setSplit(message.enabled);
  else detect(message);
};
