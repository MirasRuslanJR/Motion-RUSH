import { animate } from 'motion/react';
import { useEffect, useRef } from 'react';

const format = (v: number) => Math.round(v).toLocaleString('ru-RU');

/** Number that rolls up to its new value (writes to the DOM directly, no re-renders). */
export function RollingNumber({ value, className, duration = 0.45 }: { value: number; className?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);

  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (from === value) return;
    const controls = animate(from, value, {
      duration,
      ease: 'easeOut',
      onUpdate: (v) => {
        if (ref.current) ref.current.textContent = format(v);
      },
    });
    return () => controls.stop();
  }, [value, duration]);

  return (
    <span ref={ref} className={className}>
      {format(value)}
    </span>
  );
}
