import { useRef } from 'react';
import type { MotionEngine } from '../features/engine/MotionEngine';
import { useEngineFrame } from '../hooks/useEngine';
import { Icon } from './Icon';
import { Ring } from './Ring';
import { setRingProgress } from './ringProgress';

interface HoldGestureProps {
  engine: MotionEngine;
  /** Visible action name, e.g. "Играть снова". */
  label: string;
  holdMs?: number;
  onConfirm: () => void;
}

/**
 * Camera-first confirmation: raise both hands above your head and hold.
 * The ring fills while the pose is held and drains when released.
 * A regular button is kept as an accessible fallback.
 */
export function HoldGesture({ engine, label, holdMs = 1300, onConfirm }: HoldGestureProps) {
  const circleRef = useRef<SVGCircleElement>(null);
  const progress = useRef(0);
  const done = useRef(false);

  useEngineFrame(engine, (frame, dt) => {
    if (done.current) return;
    const armsUp = frame.trackable && frame.classification?.readings.JUMP.active === true;
    progress.current = armsUp ? progress.current + dt / holdMs : Math.max(0, progress.current - dt / (holdMs * 0.6));
    setRingProgress(circleRef.current, progress.current);
    if (progress.current >= 1) {
      done.current = true;
      onConfirm();
    }
  });

  return (
    <button
      type="button"
      className="hold"
      onClick={() => {
        if (done.current) return;
        done.current = true;
        onConfirm();
      }}
    >
      <Ring circleRef={circleRef} size={64} tone="success">
        <Icon name="up" size={22} />
      </Ring>
      <span className="hold__text">
        <span className="hold__label">{label}</span>
        <span className="hold__hint">Подними обе руки и держи</span>
      </span>
    </button>
  );
}
