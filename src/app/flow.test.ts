import { describe, expect, it } from 'vitest';
import { flowReducer, INITIAL_FLOW, type FlowAction, type FlowState } from './flow';
import type { SessionResult } from '../features/gameplay/types';

const run = (actions: FlowAction[], from: FlowState = INITIAL_FLOW) => actions.reduce(flowReducer, from);

const result: SessionResult = {
  mode: 'classic',
  scheme: 'body',
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

const setup: FlowAction[] = [
  { type: 'START' },
  { type: 'CAMERA_READY' },
  { type: 'CHECK_PASSED' },
  { type: 'CALIBRATED' },
  { type: 'TUTORIAL_DONE' },
];

describe('app flow', () => {
  it('walks the full scenario: setup → mode select → game → results → replay', () => {
    const modes = run(setup);
    expect(modes.phase).toBe('modes');
    const game = run([{ type: 'SELECT_MODE', mode: 'sprint' }], modes);
    expect(game).toMatchObject({ phase: 'game', mode: 'sprint', runId: 1 });
    const done = run([{ type: 'GAME_OVER', result }], game);
    expect(done.phase).toBe('results');
    expect(run([{ type: 'PLAY_AGAIN' }], done)).toMatchObject({ phase: 'game', mode: 'sprint', runId: 2 });
    expect(run([{ type: 'MODES' }], done).phase).toBe('modes');
  });

  it('online duel goes through the lobby and rematches there', () => {
    const lobby = run([...setup, { type: 'SELECT_MODE', mode: 'duel' }]);
    expect(lobby.phase).toBe('lobby');
    const game = run([{ type: 'DUEL_START', seed: 42 }], lobby);
    expect(game).toMatchObject({ phase: 'game', mode: 'duel', duelSeed: 42 });
    const again = run([{ type: 'GAME_OVER', result }, { type: 'PLAY_AGAIN' }], game);
    expect(again.phase).toBe('lobby');
  });

  it('leaderboard returns to where it was opened', () => {
    expect(run([{ type: 'LEADERBOARD' }, { type: 'BACK' }]).phase).toBe('landing');
    const modes = run(setup);
    expect(run([{ type: 'LEADERBOARD' }, { type: 'BACK' }], modes).phase).toBe('modes');
  });

  it('recalibration skips the tutorial once it was completed', () => {
    const s = run([...setup, { type: 'SELECT_MODE', mode: 'classic' }, { type: 'GAME_OVER', result }, { type: 'RECALIBRATE' }, { type: 'CALIBRATED' }]);
    expect(s.phase).toBe('modes');
  });

  it('camera failure leads to an error state and retry restarts permission', () => {
    const failed = run([{ type: 'START' }, { type: 'CAMERA_FAILED', kind: 'denied' }]);
    expect(failed).toMatchObject({ phase: 'camera-error', errorKind: 'denied' });
    expect(run([{ type: 'START' }], failed).phase).toBe('permission');
  });

  it('ignores out-of-order transitions', () => {
    expect(run([{ type: 'CHECK_PASSED' }]).phase).toBe('landing');
    expect(run([{ type: 'GAME_OVER', result }]).phase).toBe('landing');
    expect(run([{ type: 'DUEL_START', seed: 1 }]).phase).toBe('landing');
  });
});
