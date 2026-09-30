import type { CameraErrorKind } from '../features/camera/cameraErrors';
import type { SessionResult } from '../features/gameplay/types';
import type { GameModeId } from '../features/modes/modes';

/**
 * The whole product is one scenario:
 * LANDING → PERMISSION → CHECK → CALIBRATION → TUTORIAL → MODES → GAME (countdown inside) → RESULTS → …
 * Online duels go MODES → LOBBY → GAME → RESULTS → LOBBY (rematch).
 */
export type Phase =
  | 'landing'
  | 'permission'
  | 'camera-error'
  | 'check'
  | 'calibration'
  | 'tutorial'
  | 'modes'
  | 'lobby'
  | 'leaderboard'
  | 'game'
  | 'results';

export interface FlowState {
  phase: Phase;
  errorKind: CameraErrorKind | null;
  tutorialDone: boolean;
  runId: number;
  mode: GameModeId;
  /** Course seed shared by an online room (duel mode). */
  duelSeed: number | null;
  result: SessionResult | null;
  /** Where the leaderboard returns to. */
  back: Phase;
}

export type FlowAction =
  | { type: 'START' }
  | { type: 'CAMERA_READY' }
  | { type: 'CAMERA_FAILED'; kind: CameraErrorKind }
  | { type: 'CHECK_PASSED' }
  | { type: 'CALIBRATED' }
  | { type: 'TUTORIAL_DONE' }
  | { type: 'SELECT_MODE'; mode: GameModeId }
  | { type: 'DUEL_START'; seed: number }
  | { type: 'GAME_OVER'; result: SessionResult }
  | { type: 'PLAY_AGAIN' }
  | { type: 'MODES' }
  | { type: 'RECALIBRATE' }
  | { type: 'LEADERBOARD' }
  | { type: 'BACK' }
  | { type: 'EXIT' };

export const INITIAL_FLOW: FlowState = {
  phase: 'landing',
  errorKind: null,
  tutorialDone: false,
  runId: 0,
  mode: 'classic',
  duelSeed: null,
  result: null,
  back: 'landing',
};

const newRun = (state: FlowState, patch: Partial<FlowState> = {}): FlowState => ({
  ...state,
  ...patch,
  phase: 'game',
  runId: state.runId + 1,
});

export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case 'START':
      return { ...state, phase: 'permission', errorKind: null };
    case 'CAMERA_READY':
      return state.phase === 'permission' ? { ...state, phase: 'check' } : state;
    case 'CAMERA_FAILED':
      return { ...state, phase: 'camera-error', errorKind: action.kind };
    case 'CHECK_PASSED':
      return state.phase === 'check' ? { ...state, phase: 'calibration' } : state;
    case 'CALIBRATED':
      if (state.phase !== 'calibration') return state;
      return { ...state, phase: state.tutorialDone ? 'modes' : 'tutorial' };
    case 'TUTORIAL_DONE':
      return state.phase === 'tutorial' ? { ...state, phase: 'modes', tutorialDone: true } : state;
    case 'SELECT_MODE':
      if (action.mode === 'duel') return { ...state, mode: 'duel', phase: 'lobby', duelSeed: null };
      return newRun(state, { mode: action.mode, duelSeed: null });
    case 'DUEL_START':
      return state.phase === 'lobby' ? newRun(state, { mode: 'duel', duelSeed: action.seed }) : state;
    case 'GAME_OVER':
      return state.phase === 'game' ? { ...state, phase: 'results', result: action.result } : state;
    case 'PLAY_AGAIN':
      return state.mode === 'duel' ? { ...state, phase: 'lobby', duelSeed: null } : newRun(state);
    case 'MODES':
      return { ...state, phase: 'modes' };
    case 'RECALIBRATE':
      return { ...state, phase: 'calibration' };
    case 'LEADERBOARD':
      return state.phase === 'leaderboard' ? state : { ...state, phase: 'leaderboard', back: state.phase };
    case 'BACK':
      return state.phase === 'leaderboard' ? { ...state, phase: state.back } : state;
    case 'EXIT':
      return { ...INITIAL_FLOW, tutorialDone: state.tutorialDone, mode: state.mode };
  }
}

export const SETUP_STEPS: { phase: Phase; label: string }[] = [
  { phase: 'check', label: 'Камера' },
  { phase: 'calibration', label: 'Калибровка' },
  { phase: 'tutorial', label: 'Обучение' },
  { phase: 'modes', label: 'Режим' },
];
