import { useEffect, useLayoutEffect, useRef } from 'react';
import type { FrameListener, GestureListener, MotionEngine, MotionUiState } from '../features/engine/MotionEngine';
import { useStore } from '../lib/store';

/** Subscribe to every animation frame of the engine. The callback may change between renders. */
export function useEngineFrame(engine: MotionEngine | null, callback: FrameListener): void {
  const ref = useRef(callback);
  useLayoutEffect(() => {
    ref.current = callback;
  });
  useEffect(() => {
    if (!engine) return;
    return engine.onFrame((frame, dt) => ref.current(frame, dt));
  }, [engine]);
}

export function useGestureEvents(engine: MotionEngine | null, callback: GestureListener): void {
  const ref = useRef(callback);
  useLayoutEffect(() => {
    ref.current = callback;
  });
  useEffect(() => {
    if (!engine) return;
    return engine.onGesture((event) => ref.current(event));
  }, [engine]);
}

export function useMotionUi<S>(engine: MotionEngine, selector: (state: MotionUiState) => S): S {
  return useStore(engine.ui, selector);
}
