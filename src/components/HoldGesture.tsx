import { useEffect, useRef } from 'react';
import type { MotionEngine } from '../features/engine/MotionEngine';
import { useEngineFrame, useGestureEvents, useMotionUi } from '../hooks/useEngine';
import { Icon } from './Icon';
import { Ring } from './Ring';
import { setRingProgress } from './ringProgress';

const ARM_DELAY_MS = 1200;

interface HoldGestureProps {
  engine: MotionEngine;
  /** Visible action name, e.g. "Играть снова". */
  label: string;
  holdMs?: number;
  onConfirm: () => void;
  /** Disable gesture confirmation (the button still works). */
  gestureEnabled?: boolean;
}

/**
 * Camera-first confirmation:
 *   standing (body scheme) — jump once;
 *   seated — raise both hands above your head and hold.
 * A regular button is kept as an accessible fallback.
 */
export function HoldGesture({ engine, label, holdMs = 1300, onConfirm, gestureEnabled = true }: HoldGestureProps) {
  const scheme = useMotionUi(engine, (s) => s.scheme);
  const circleRef = useRef<SVGCircleElement>(null);
  const progress = useRef(0);
  const jumpedAt = useRef<number | null>(null);
  const done = useRef(false);
  /** Gestures count only a moment after the control appears (the player may still be mid-move). */
  const armedAt = useRef(Number.POSITIVE_INFINITY);
  useEffect(() => {
    armedAt.current = performance.now() + ARM_DELAY_MS;
  }, []);

  const confirm = () => {
    if (done.current) return;
    done.current = true;
    onConfirm();
  };

  useGestureEvents(engine, (event) => {
    if (!gestureEnabled || scheme !== 'body' || event.type !== 'JUMP' || event.phase !== 'start') return;
    if (event.timestamp < armedAt.current) return;
    jumpedAt.current ??= event.timestamp;
  });

  useEngineFrame(engine, (frame, dt) => {
    if (done.current || !gestureEnabled || frame.time < armedAt.current) return;
    if (scheme === 'body') {
      // One real jump fills the ring over 350 ms, then confirms.
      if (jumpedAt.current !== null) {
        progress.current = Math.min(1, (frame.time - jumpedAt.current) / 350);
        setRingProgress(circleRef.current, progress.current);
        if (progress.current >= 1) confirm();
      }
      return;
    }
    const armsUp = frame.trackable && frame.classification?.readings.JUMP.active === true;
    progress.current = armsUp ? progress.current + dt / holdMs : Math.max(0, progress.current - dt / (holdMs * 0.6));
    setRingProgress(circleRef.current, progress.current);
    if (progress.current >= 1) confirm();
  });

  return (
    <button type="button" className="hold" onClick={confirm}>
      <Ring circleRef={circleRef} size={64} tone="success">
        <Icon name="up" size={22} />
      </Ring>
      <span className="hold__text">
        <span className="hold__label">{label}</span>
        <span className="hold__hint">{scheme === 'body' ? 'Подпрыгни' : 'Подними обе руки и держи'}</span>
      </span>
    </button>
  );
}
