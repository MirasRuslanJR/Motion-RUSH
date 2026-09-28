import type { ReactNode, Ref } from 'react';
import { RING_CIRCUMFERENCE, RING_RADIUS as RADIUS } from './ringProgress';

interface RingProps {
  circleRef?: Ref<SVGCircleElement>;
  size?: number;
  tone?: 'cyan' | 'success' | 'warn';
  initial?: number;
  children?: ReactNode;
  className?: string;
}

export function Ring({ circleRef, size = 120, tone = 'cyan', initial = 0, children, className }: RingProps) {
  return (
    <div className={`ring ring--${tone} ${className ?? ''}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="ring__bg" cx="50" cy="50" r={RADIUS} />
        <circle
          ref={circleRef}
          className="ring__fg"
          cx="50"
          cy="50"
          r={RADIUS}
          strokeDasharray={RING_CIRCUMFERENCE}
          style={{ strokeDashoffset: RING_CIRCUMFERENCE * (1 - initial) }}
        />
      </svg>
      <div className="ring__content">{children}</div>
    </div>
  );
}
