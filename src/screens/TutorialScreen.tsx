import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraViewport } from '../components/CameraViewport';
import { DemoFigure } from '../components/DemoFigure';
import { HintPanel } from '../components/HintPanel';
import { Icon } from '../components/Icon';
import { Ring } from '../components/Ring';
import { setRingProgress } from '../components/ringProgress';
import type { MotionEngine } from '../features/engine/MotionEngine';
import { motionMeta, type GestureType } from '../features/gestures/types';
import { useEngineFrame, useMotionUi } from '../hooks/useEngine';
import { sfx } from '../lib/audio/sfx';
import './SetupScreens.css';

const STEPS: GestureType[] = ['LEAN_LEFT', 'LEAN_RIGHT', 'JUMP', 'CROUCH'];
const HOLD_MS = 450;
const SKIP_AFTER_MS = 10000;

interface TutorialScreenProps {
  engine: MotionEngine;
  onDone: () => void;
}

export function TutorialScreen({ engine, onDone }: TutorialScreenProps) {
  const [step, setStep] = useState(0);
  const [success, setSuccess] = useState(false);
  /** Step index for which "skip" has been unlocked (after SKIP_AFTER_MS). */
  const [skipUnlockedFor, setSkipUnlockedFor] = useState(-1);
  const circleRef = useRef<SVGCircleElement>(null);
  const held = useRef(0);
  const gesture = STEPS[step] ?? 'JUMP';
  const scheme = useMotionUi(engine, (s) => s.scheme);
  const meta = motionMeta(gesture, scheme);
  /** A real jump is short: one confirmed take-off counts, other moves are held briefly. */
  const holdMs = scheme === 'body' && gesture === 'JUMP' ? 0 : HOLD_MS;

  useEffect(() => {
    engine.setExpected(success ? null : gesture);
  }, [engine, gesture, success]);

  useEffect(() => () => engine.setExpected(null), [engine]);

  useEffect(() => {
    held.current = 0;
    const timer = window.setTimeout(() => setSkipUnlockedFor(step), SKIP_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [step]);
  const canSkip = skipUnlockedFor === step;

  const advance = useCallback(() => {
    setSuccess(false);
    if (step + 1 >= STEPS.length) onDone();
    else setStep(step + 1);
  }, [step, onDone]);

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(advance, 1000);
    return () => window.clearTimeout(timer);
  }, [success, advance]);

  useEngineFrame(engine, (frame, dt) => {
    if (success) return;
    const confirmed =
      (frame.lateral.phase === 'CONFIRMED' && frame.lateral.gesture === gesture) ||
      (frame.vertical.phase === 'CONFIRMED' && frame.vertical.gesture === gesture);
    held.current = confirmed ? held.current + dt : 0;
    setRingProgress(circleRef.current, holdMs === 0 ? (confirmed ? 1 : 0) : held.current / holdMs);
    if (confirmed && held.current >= holdMs) {
      sfx.play('confirm');
      setSuccess(true);
    }
  });

  return (
    <main className="screen setup tutorial">
      <div className="tutorial__main">
        <CameraViewport engine={engine} variant="stage" guidance={!success} className="setup__viewport" />
        <HintPanel engine={engine} />
      </div>

      <aside className="setup__panel tutorial__panel">
        <p className="t-label">Шаг 3 из 4 · обучение · движение {step + 1} из {STEPS.length}</p>
        <ol className="tutorial__steps" aria-label="Движения">
          {STEPS.map((g, i) => {
            const m = motionMeta(g, scheme);
            const done = i < step || (i === step && success);
            return (
              <li key={g} className={done ? 'is-done' : i === step ? 'is-current' : ''}>
                <span className="tutorial__step-icon">
                  {done ? <Icon name="check" size={14} /> : m.arrow && <Icon name={m.arrow} size={14} />}
                </span>
                {m.title}
              </li>
            );
          })}
        </ol>

        <AnimatePresence mode="wait">
          <motion.div
            key={gesture}
            className="tutorial__card"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.25 }}
          >
            <DemoFigure move={gesture} scheme={scheme} className="tutorial__figure" label={`Пример: ${meta.cue}`} />
            <h1 className="t-headline tutorial__title">{meta.title}</h1>
            <p className="tutorial__cue">{meta.cue}</p>
            <p className="t-label tutorial__action">
              В игре → {meta.action}
            </p>
          </motion.div>
        </AnimatePresence>

        <div className="tutorial__hold">
          <Ring circleRef={circleRef} size={64} tone={success ? 'success' : 'cyan'}>
            {success ? <Icon name="check" size={22} /> : meta.arrow && <Icon name={meta.arrow} size={22} />}
          </Ring>
          <p>{success ? 'Засчитано!' : holdMs === 0 ? 'Подпрыгни по-настоящему — обеими ногами' : 'Сделай движение и задержись на полсекунды'}</p>
        </div>

        <div className="tutorial__skip">
          {canSkip && !success && (
            <button type="button" className="btn btn--ghost btn--small" onClick={advance}>
              Пропустить шаг
            </button>
          )}
          <button type="button" className="btn btn--link" onClick={onDone}>
            Я знаю движения — к игре
          </button>
        </div>
      </aside>
    </main>
  );
}
