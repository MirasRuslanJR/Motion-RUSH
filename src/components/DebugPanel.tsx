import { useRef } from 'react';
import type { MotionEngine, MotionFrame } from '../features/engine/MotionEngine';
import { GESTURE_TYPES } from '../features/gestures/types';
import { useEngineFrame } from '../hooks/useEngine';

const n = (v: number | null | undefined, digits = 2) => (v === null || v === undefined ? '—' : v.toFixed(digits));

function describe(f: Readonly<MotionFrame>, engine: MotionEngine): string {
  const ui = engine.ui.get();
  const ft = f.features;
  const c = f.classification;
  const b = f.baseline;
  const lines = [
    `FPS ${f.stats.fps} · inference ${f.stats.inferenceFps}/${f.stats.targetInferenceFps} Hz · ${n(f.stats.inferenceMs, 1)} ms · ${ui.delegate ?? '—'}`,
    `camera ${f.videoWidth}×${f.videoHeight} · aspect ${n(f.aspect)}`,
    `tracking ${f.quality.status} (ui ${ui.tracking}) · core ${n(f.quality.coreVisibility)} · hips ${f.quality.hipsVisible ? 'yes' : 'no'} · sw ${n(f.quality.shoulderWidth, 3)}`,
    `lowLight ${ui.lowLight} · headroom ${!f.quality.lowHeadroom} · multi ${ui.multiplePeople}`,
    `lateral ${f.lateral.gesture ?? ''} ${f.lateral.phase} · vertical ${f.vertical.gesture ?? ''} ${f.vertical.phase}`,
    `expected ${f.expected ?? '—'} · rule ${f.diagnosis?.ruleId ?? '—'} (${f.diagnosis?.verdict ?? '—'}) · ${Math.round((f.diagnosis?.progress ?? 0) * 100)}%`,
  ];
  if (ft) {
    lines.push(
      `leanX ${n(ft.leanX)} headX ${n(ft.headX)} crouch ${n(ft.crouchDepth)} nose↓ ${n(ft.noseDrop)} hip↓ ${n(ft.hipDrop)} scale ${n(ft.scaleRatio)}`,
      `handL ${n(ft.leftHandLift)} (eff ${n(ft.leftHandLiftEffective)}) handR ${n(ft.rightHandLift)} (eff ${n(ft.rightHandLiftEffective)}) elbow ${n(ft.leftElbowAngle, 0)}°/${n(ft.rightElbowAngle, 0)}°`,
    );
  }
  if (c) {
    lines.push(
      GESTURE_TYPES.map((g) => {
        const r = c.readings[g];
        return `${g} ${n(r.metric)}/${n(r.thresholds.activation)} c${n(r.confidence)}`;
      }).join(' · '),
    );
  }
  if (b) lines.push(`baseline mode ${b.mode} · SW ${n(b.scale, 3)} · ARM ${n(b.armLength, 3)} (${n(b.armLength / b.scale)} SW)`);
  return lines.join('\n');
}

/** Developer overlay, only with ?debug=1. Writes text directly, 5×/s. */
export function DebugPanel({ engine }: { engine: MotionEngine }) {
  const ref = useRef<HTMLPreElement>(null);
  const last = useRef(0);
  useEngineFrame(engine, (frame) => {
    if (frame.time - last.current < 200 || !ref.current) return;
    last.current = frame.time;
    ref.current.textContent = describe(frame, engine);
  });
  return <pre ref={ref} className="debug-panel" aria-hidden="true" />;
}
