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

/** The first game: camera permission, check, calibration and the tutorial, then the mode. */
const firstPlay = (mode: FlowState['mode']): FlowAction[] => [
  { type: 'PLAY', mode, cameraOn: false },
  { type: 'CAMERA_READY' },
  { type: 'CHECK_PASSED' },
  { type: 'CALIBRATED' },
  { type: 'TUTORIAL_DONE' },
];

describe('app flow', () => {
  it('opens on the main menu — there is no separate start screen', () => {
    expect(INITIAL_FLOW.phase).toBe('menu');
  });

  it('the first game sets the camera up and then starts the chosen mode right away', () => {
    expect(run([{ type: 'PLAY', mode: 'sprint', cameraOn: false }]).phase).toBe('permission');
    const game = run(firstPlay('sprint'));
    expect(game).toMatchObject({ phase: 'game', mode: 'sprint', runId: 1, ready: true, tutorialDone: true });
    const done = run([{ type: 'GAME_OVER', result }], game);
    expect(done.phase).toBe('results');
    expect(run([{ type: 'PLAY_AGAIN' }], done)).toMatchObject({ phase: 'game', mode: 'sprint', runId: 2 });
    const menu = run([{ type: 'MENU' }], done);
    expect(menu.phase).toBe('menu');
    // Once set up, a mode starts straight from the menu.
    expect(run([{ type: 'PLAY', mode: 'dance', cameraOn: true }], menu)).toMatchObject({ phase: 'dance', mode: 'dance', runId: 2 });
  });

  it('mini-games, the dance floor and two-player modes open their own screens and replay in place', () => {
    const ready = run([...firstPlay('classic'), { type: 'MENU' }]);
    const arcade = run([{ type: 'PLAY', mode: 'stars', cameraOn: true }], ready);
    expect(arcade).toMatchObject({ phase: 'arcade', mode: 'stars' });
    expect(run([{ type: 'PLAY_AGAIN' }], arcade)).toMatchObject({ phase: 'arcade', runId: arcade.runId + 1 });
    for (const mode of ['freeze', 'reaction', 'squats'] as const) expect(run([{ type: 'PLAY', mode, cameraOn: true }], ready).phase).toBe('arcade');
    expect(run([{ type: 'PLAY', mode: 'versus', cameraOn: true }], ready).phase).toBe('versus');
    expect(run([{ type: 'PLAY', mode: 'dance-duo', cameraOn: true }], ready).phase).toBe('dance');
  });

  it('online duel goes through the lobby and rematches there', () => {
    const lobby = run(firstPlay('duel'));
    expect(lobby.phase).toBe('lobby');
    const game = run([{ type: 'DUEL_START', seed: 42 }], lobby);
    expect(game).toMatchObject({ phase: 'game', mode: 'duel', duelSeed: 42 });
    const again = run([{ type: 'GAME_OVER', result }, { type: 'PLAY_AGAIN' }], game);
    expect(again.phase).toBe('lobby');
  });

  it('the tutorial runs the first time only, and again on request from the menu', () => {
    const ready = run([...firstPlay('classic'), { type: 'MENU' }]);
    // Second setup (e.g. recalibration) skips the tutorial.
    expect(run([{ type: 'RECALIBRATE' }, { type: 'CALIBRATED' }], ready)).toMatchObject({ phase: 'game', mode: 'classic' });
    const tutorial = run([{ type: 'TUTORIAL', cameraOn: true }], ready);
    expect(tutorial.phase).toBe('tutorial');
    expect(run([{ type: 'TUTORIAL_DONE' }], tutorial).phase).toBe('menu');
    // Before the camera is set up the tutorial comes after the calibration and returns to the menu.
    const cold = run([{ type: 'TUTORIAL', cameraOn: false }, { type: 'CAMERA_READY' }, { type: 'CHECK_PASSED' }, { type: 'CALIBRATED' }]);
    expect(cold.phase).toBe('tutorial');
    expect(run([{ type: 'TUTORIAL_DONE' }], cold).phase).toBe('menu');
  });

  it('an already running camera skips the permission step', () => {
    expect(run([{ type: 'PLAY', mode: 'classic', cameraOn: true }]).phase).toBe('check');
  });

  it('leaderboard returns to where it was opened', () => {
    expect(run([{ type: 'LEADERBOARD' }, { type: 'BACK' }]).phase).toBe('menu');
    const done = run([...firstPlay('classic'), { type: 'GAME_OVER', result }]);
    expect(run([{ type: 'LEADERBOARD' }, { type: 'BACK' }], done).phase).toBe('results');
  });

  it('camera failure leads to an error state and retry restarts permission', () => {
    const failed = run([{ type: 'PLAY', mode: 'classic', cameraOn: false }, { type: 'CAMERA_FAILED', kind: 'denied' }]);
    expect(failed).toMatchObject({ phase: 'camera-error', errorKind: 'denied', ready: false });
    expect(run([{ type: 'RETRY' }], failed).phase).toBe('permission');
  });

  it('ignores out-of-order transitions', () => {
    expect(run([{ type: 'CHECK_PASSED' }]).phase).toBe('menu');
    expect(run([{ type: 'GAME_OVER', result }]).phase).toBe('menu');
    expect(run([{ type: 'DUEL_START', seed: 1 }]).phase).toBe('menu');
    expect(run([{ type: 'TUTORIAL_DONE' }]).phase).toBe('menu');
  });
});
