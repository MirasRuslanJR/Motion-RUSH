import type { CameraErrorKind } from '../features/camera/cameraErrors';
import type { SessionResult } from '../features/gameplay/types';
import { getMode, type GameModeId } from '../features/modes/modes';

/**
 * The game opens on the main menu. Picking a mode for the first time sets the camera up
 * (PERMISSION → CHECK → CALIBRATION → TUTORIAL the first time) and then starts that mode
 * right away; after that a mode starts straight from the menu.
 * Online duels go MENU → LOBBY → GAME → RESULTS → LOBBY (rematch).
 */
export type Phase =
  | 'menu'
  | 'permission'
  | 'camera-error'
  | 'check'
  | 'calibration'
  | 'tutorial'
  | 'lobby'
  | 'leaderboard'
  | 'game'
  | 'dance'
  | 'versus'
  | 'arcade'
  | 'results';

/** What the camera setup leads to: the chosen mode, the tutorial, or back to the menu. */
export type AfterSetup = 'play' | 'tutorial' | 'menu';

export interface FlowState {
  phase: Phase;
  errorKind: CameraErrorKind | null;
  tutorialDone: boolean;
  /** The camera is set up and calibrated: modes start right away. */
  ready: boolean;
  after: AfterSetup;
  runId: number;
  mode: GameModeId;
  /** Course seed shared by an online room (duel mode). */
  duelSeed: number | null;
  result: SessionResult | null;
  /** Where the leaderboard returns to. */
  back: Phase;
}

export type FlowAction =
  /** Play a mode from the menu; `cameraOn` = the camera is already running. */
  | { type: 'PLAY'; mode: GameModeId; cameraOn: boolean }
  | { type: 'TUTORIAL'; cameraOn: boolean }
  | { type: 'RETRY' }
  | { type: 'CAMERA_READY' }
  | { type: 'CAMERA_FAILED'; kind: CameraErrorKind }
  | { type: 'CHECK_PASSED' }
  | { type: 'CALIBRATED' }
  | { type: 'TUTORIAL_DONE' }
  | { type: 'DUEL_START'; seed: number }
  | { type: 'GAME_OVER'; result: SessionResult }
  | { type: 'PLAY_AGAIN' }
  | { type: 'MENU' }
  | { type: 'RECALIBRATE' }
  | { type: 'LEADERBOARD' }
  | { type: 'BACK' };

export const INITIAL_FLOW: FlowState = {
  phase: 'menu',
  errorKind: null,
  tutorialDone: false,
  ready: false,
  after: 'menu',
  runId: 0,
  mode: 'classic',
  duelSeed: null,
  result: null,
  back: 'menu',
};

/** The screen a mode is played on (a new run id re-mounts it). */
export function launch(state: FlowState, mode: GameModeId): FlowState {
  if (mode === 'duel') return { ...state, mode, phase: 'lobby', duelSeed: null };
  const def = getMode(mode);
  const phase: Phase = def.kind === 'dance' ? 'dance' : def.kind === 'arcade' ? 'arcade' : def.players === 2 ? 'versus' : 'game';
  return { ...state, mode, phase, runId: state.runId + 1, duelSeed: null };
}

/** Starts the camera setup: from the permission prompt, or from the check if the camera is already on. */
function setup(state: FlowState, after: AfterSetup, cameraOn: boolean): FlowState {
  return { ...state, after, errorKind: null, phase: cameraOn ? 'check' : 'permission' };
}

/** Where the setup ends. */
function afterSetup(state: FlowState): FlowState {
  if (state.after === 'play') return launch(state, state.mode);
  return { ...state, phase: 'menu' };
}

export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case 'PLAY':
      if (state.ready) return launch(state, action.mode);
      return setup({ ...state, mode: action.mode }, 'play', action.cameraOn);
    case 'TUTORIAL':
      if (state.ready) return { ...state, phase: 'tutorial', after: 'menu' };
      return setup(state, 'tutorial', action.cameraOn);
    case 'RETRY':
      return { ...state, phase: 'permission', errorKind: null };
    case 'CAMERA_READY':
      return state.phase === 'permission' ? { ...state, phase: 'check' } : state;
    case 'CAMERA_FAILED':
      return { ...state, phase: 'camera-error', errorKind: action.kind, ready: false };
    case 'CHECK_PASSED':
      return state.phase === 'check' ? { ...state, phase: 'calibration' } : state;
    case 'CALIBRATED': {
      if (state.phase !== 'calibration') return state;
      const next = { ...state, ready: true };
      if (state.after === 'tutorial' || !state.tutorialDone) return { ...next, phase: 'tutorial' };
      return afterSetup(next);
    }
    case 'TUTORIAL_DONE':
      return state.phase === 'tutorial' ? afterSetup({ ...state, tutorialDone: true, ready: true }) : state;
    case 'DUEL_START':
      return state.phase === 'lobby' ? { ...state, mode: 'duel', phase: 'game', runId: state.runId + 1, duelSeed: action.seed } : state;
    case 'GAME_OVER':
      return state.phase === 'game' ? { ...state, phase: 'results', result: action.result } : state;
    case 'PLAY_AGAIN':
      if (state.phase === 'dance' || state.phase === 'versus' || state.phase === 'arcade') return { ...state, runId: state.runId + 1 };
      return state.mode === 'duel' ? { ...state, phase: 'lobby', duelSeed: null } : launch(state, state.mode);
    case 'MENU':
      return { ...state, phase: 'menu' };
    case 'RECALIBRATE':
      // Recalibrate, then carry on with the same mode.
      return { ...state, phase: 'calibration', after: 'play' };
    case 'LEADERBOARD':
      return state.phase === 'leaderboard' ? state : { ...state, phase: 'leaderboard', back: state.phase };
    case 'BACK':
      return state.phase === 'leaderboard' ? { ...state, phase: state.back } : state;
  }
}

export const SETUP_STEPS: { phase: Phase; label: string }[] = [
  { phase: 'check', label: 'Камера' },
  { phase: 'calibration', label: 'Калибровка' },
  { phase: 'tutorial', label: 'Обучение' },
];
