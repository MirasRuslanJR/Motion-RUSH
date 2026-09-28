import { describe, expect, it } from 'vitest';
import { flowReducer, INITIAL_FLOW, type FlowAction, type FlowState } from './flow';
import type { SessionResult } from '../features/gameplay/types';

const run = (actions: FlowAction[], from: FlowState = INITIAL_FLOW) => actions.reduce(flowReducer, from);

const result: SessionResult = {
  outcome: 'complete',
  score: 1000,
  bestCombo: 5,
  durationMs: 60000,
  obstacles: [],
  gesturesDetected: 10,
  hintsShown: 2,
  orbsCollected: 1,
  orbsTotal: 3,
  timeline: [],
};

describe('app flow', () => {
  it('walks the full scenario from landing to results and replay', () => {
    const s = run([
      { type: 'START' },
      { type: 'CAMERA_READY' },
      { type: 'CHECK_PASSED' },
      { type: 'CALIBRATED' },
      { type: 'TUTORIAL_DONE' },
    ]);
    expect(s.phase).toBe('game');
    expect(s.runId).toBe(1);
    const done = run([{ type: 'GAME_OVER', result }], s);
    expect(done.phase).toBe('results');
    expect(done.result?.score).toBe(1000);
    expect(run([{ type: 'PLAY_AGAIN' }], done)).toMatchObject({ phase: 'game', runId: 2 });
  });

  it('recalibration skips the tutorial once it was completed', () => {
    const s = run([
      { type: 'START' },
      { type: 'CAMERA_READY' },
      { type: 'CHECK_PASSED' },
      { type: 'CALIBRATED' },
      { type: 'TUTORIAL_DONE' },
      { type: 'GAME_OVER', result },
      { type: 'RECALIBRATE' },
      { type: 'CALIBRATED' },
    ]);
    expect(s.phase).toBe('game');
  });

  it('camera failure leads to an error state and retry restarts permission', () => {
    const failed = run([{ type: 'START' }, { type: 'CAMERA_FAILED', kind: 'denied' }]);
    expect(failed).toMatchObject({ phase: 'camera-error', errorKind: 'denied' });
    expect(run([{ type: 'START' }], failed).phase).toBe('permission');
  });

  it('ignores out-of-order transitions', () => {
    expect(run([{ type: 'CHECK_PASSED' }]).phase).toBe('landing');
    expect(run([{ type: 'GAME_OVER', result }]).phase).toBe('landing');
  });
});
