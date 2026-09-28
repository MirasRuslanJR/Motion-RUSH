import type { CameraErrorKind } from '../features/camera/cameraErrors';
import type { SessionResult } from '../features/gameplay/types';

/**
 * The whole product is one linear scenario:
 * LANDING → PERMISSION → CHECK → CALIBRATION → TUTORIAL → GAME (countdown inside) → RESULTS → GAME…
 */
export type Phase = 'landing' | 'permission' | 'camera-error' | 'check' | 'calibration' | 'tutorial' | 'game' | 'results';

export interface FlowState {
  phase: Phase;
  errorKind: CameraErrorKind | null;
  tutorialDone: boolean;
  runId: number;
  result: SessionResult | null;
}

export type FlowAction =
  | { type: 'START' }
  | { type: 'CAMERA_READY' }
  | { type: 'CAMERA_FAILED'; kind: CameraErrorKind }
  | { type: 'CHECK_PASSED' }
  | { type: 'CALIBRATED' }
  | { type: 'TUTORIAL_DONE' }
  | { type: 'GAME_OVER'; result: SessionResult }
  | { type: 'PLAY_AGAIN' }
  | { type: 'RECALIBRATE' }
  | { type: 'EXIT' };

export const INITIAL_FLOW: FlowState = { phase: 'landing', errorKind: null, tutorialDone: false, runId: 0, result: null };

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
      return state.tutorialDone ? { ...state, phase: 'game', runId: state.runId + 1 } : { ...state, phase: 'tutorial' };
    case 'TUTORIAL_DONE':
      return state.phase === 'tutorial' ? { ...state, phase: 'game', tutorialDone: true, runId: state.runId + 1 } : state;
    case 'GAME_OVER':
      return state.phase === 'game' ? { ...state, phase: 'results', result: action.result } : state;
    case 'PLAY_AGAIN':
      return { ...state, phase: 'game', runId: state.runId + 1 };
    case 'RECALIBRATE':
      return { ...state, phase: 'calibration' };
    case 'EXIT':
      return { ...INITIAL_FLOW, tutorialDone: state.tutorialDone };
  }
}

export const SETUP_STEPS: { phase: Phase; label: string }[] = [
  { phase: 'check', label: 'Камера' },
  { phase: 'calibration', label: 'Калибровка' },
  { phase: 'tutorial', label: 'Обучение' },
  { phase: 'game', label: 'Игра' },
];
