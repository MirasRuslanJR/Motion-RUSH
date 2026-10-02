import { AnimatePresence, motion } from 'motion/react';
import { useRef } from 'react';
import type { MotionEngine } from '../features/engine/MotionEngine';
import type { Verdict } from '../features/gestures/diagnosisRules';
import type { Arrow } from '../features/gestures/types';
import { useEngineFrame, useMotionUi } from '../hooks/useEngine';
import { Icon } from './Icon';
import './HintPanel.css';

const VERDICT_LABEL: Record<Verdict, string> = {
  correct: 'Есть!',
  near: 'Почти',
  wrong: 'Исправь',
  other: 'Не то движение',
  idle: 'Сделай',
};

interface HintPanelProps {
  engine: MotionEngine;
  variant?: 'full' | 'compact';
  /** In-game: the move the coming obstacle needs, shown big on top of the hint. */
  headline?: { title: string; arrow: Arrow | null } | null;
  /** Full panel with nothing to correct yet: what to tell the player instead of an empty meter. */
  idle?: string;
}

/**
 * Error mode made visible: what is wrong, which body part, which direction,
 * and a live meter of how far the player is from the target.
 */
export function HintPanel({
  engine,
  variant = 'full',
  headline = null,
  idle = 'Начни движение — здесь появится подсказка, что поправить',
}: HintPanelProps) {
  const hint = useMotionUi(engine, (s) => s.hint);
  const fillRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef<HTMLSpanElement>(null);
  const lastPct = useRef(-1);

  useEngineFrame(engine, (frame) => {
    const progress = frame.diagnosis?.progress ?? 0;
    const pct = Math.round(progress * 100);
    if (pct === lastPct.current) return;
    lastPct.current = pct;
    if (fillRef.current) fillRef.current.style.transform = `scaleX(${Math.min(progress, 1)})`;
    if (valueRef.current) valueRef.current.textContent = `${pct}%`;
  });

  return (
    <div className={`hint hint--${variant}`} data-verdict={hint?.verdict ?? 'none'} data-headline={headline ? 'yes' : undefined}>
      {headline && (
        <div className="hint__headline">
          {headline.arrow && <Icon name={headline.arrow} size={30} className="hint__arrow" />}
          <strong className="hint__title">{headline.title}</strong>
          {hint && <span className="hint__label">{VERDICT_LABEL[hint.verdict]}</span>}
        </div>
      )}
      {!hint && !headline && variant === 'full' && <p className="hint__idle">{idle}</p>}
      <AnimatePresence mode="popLayout" initial={false}>
        {hint && (
          <motion.div
            key={`${hint.ruleId}|${hint.message}`}
            className="hint__body"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            {!headline && <span className="hint__label">{VERDICT_LABEL[hint.verdict]}</span>}
            <p className="hint__message" role="status" aria-live="polite">
              {hint.arrow && !headline && <Icon name={hint.arrow} size={variant === 'compact' ? 18 : 22} className="hint__arrow" />}
              {hint.message}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="hint__meter" aria-hidden={!hint}>
        <div className="hint__meter-head">
          <span>{hint?.metric ?? 'Прогресс'}</span>
          <span ref={valueRef} className="hint__meter-value">
            0%
          </span>
        </div>
        <div className="hint__track">
          <div ref={fillRef} className="hint__fill" />
          <div className="hint__target" title="Цель" />
        </div>
      </div>
    </div>
  );
}
