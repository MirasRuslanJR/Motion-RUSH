import { installMediapipeLogFilter, LandmarkerCore } from './landmarkerCore';
import { packPoses } from './landmarkPacking';
import type { WorkerRequest, WorkerResponse } from './workerProtocol';

/**
 * Pose inference off the main thread: MediaPipe runs here (WASM + WebGL on an
 * OffscreenCanvas), so a 15–50 ms inference never blocks rendering or input.
 */

interface WorkerScope {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
}

const scope = self as unknown as WorkerScope;
let core: LandmarkerCore | null = null;

async function init(message: Extract<WorkerRequest, { type: 'init' }>): Promise<void> {
  if (message.filterLogs) installMediapipeLogFilter();
  try {
    // useModule = true: in a module worker the bundle loads the ES-module WASM loader via import().
    core = await LandmarkerCore.create(message.sources, true, message.delegate);
    scope.postMessage({ type: 'ready', delegate: core.delegate });
  } catch (error) {
    scope.postMessage({ type: 'init-error', message: error instanceof Error ? error.message : String(error) });
  }
}

function detect(message: Extract<WorkerRequest, { type: 'frame' }>): void {
  const { frame, timestamp } = message;
  try {
    const started = performance.now();
    const poses = core ? core.detect(frame, timestamp) : null;
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
  else detect(message);
};
