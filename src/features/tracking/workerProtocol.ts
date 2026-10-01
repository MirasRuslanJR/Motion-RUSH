import type { AssetSource, Delegate } from './landmarkerCore';
import type { TwoPlayerTracking } from './splitTracking';

/** Messages between the main thread and pose.worker.ts. */
export type WorkerRequest =
  | { type: 'init'; sources: AssetSource[]; filterLogs: boolean; delegate: Delegate | null }
  | { type: 'frame'; frame: VideoFrame | ImageBitmap; timestamp: number }
  /** Two players: track the left and right part of the picture separately. */
  | { type: 'split'; enabled: boolean };

export type WorkerResponse =
  | { type: 'ready'; delegate: Delegate }
  | { type: 'init-error'; message: string }
  | {
      type: 'result';
      /** Packed landmarks, see landmarkPacking.ts. Transferred, not copied. */
      data: Float32Array;
      count: number;
      timestamp: number;
      inferenceMs: number;
      delegate: Delegate;
      /** No answer for this frame (warming up / switching delegate) — NOT "nobody in frame". */
      skipped: boolean;
      /** The landmarker could not read this kind of frame (switch input type). */
      inputRejected: boolean;
      /** Two-player mode: player slot (0 = P1, 1 = P2) of each packed pose. */
      slots?: number[];
      split: TwoPlayerTracking;
    }
  | { type: 'fatal'; message: string };
