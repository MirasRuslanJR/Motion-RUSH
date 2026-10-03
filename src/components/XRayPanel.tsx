import { useCallback, useRef } from 'react';
import type { MotionEngine, MotionFrame } from '../features/engine/MotionEngine';
import type { ChannelState } from '../features/gestures/GestureStateMachine';
import { motionMeta, schemeOf } from '../features/gestures/types';
import { useEngineFrame } from '../hooks/useEngine';
import './XRayPanel.css';

const PHASES: Record<ChannelState['phase'], string> = {
  NEUTRAL: 'нет',
  CANDIDATE: 'проверяю',
  CONFIRMED: 'есть',
  COOLDOWN: 'пауза',
};

const VERDICTS: Record<string, string> = {
  correct: 'верно',
  near: 'почти',
  wrong: 'ошибка в технике',
  other: 'другой жест',
  idle: 'ждём попытку',
};

const fmt = (v: number) => (Math.abs(v) < 0.005 ? '0.00' : v.toFixed(2));

function channelText(state: Readonly<ChannelState>, frame: Readonly<MotionFrame>): string {
  if (state.phase === 'NEUTRAL') return 'нет';
  const scheme = schemeOf(frame.baseline?.mode ?? null);
  const name = state.gesture ? motionMeta(state.gesture, scheme).title.toLowerCase() : '';
  return `${PHASES[state.phase]}${name ? ` — ${name}` : ''}`;
}

/** The DOM nodes the panel writes into, by name. */
type Slot =
  | 'rate'
  | 'body'
  | 'laneRoot'
  | 'laneLabel'
  | 'laneDot'
  | 'laneLeft'
  | 'laneRight'
  | 'laneValue'
  | 'jumpRoot'
  | 'jumpLabel'
  | 'jumpFill'
  | 'jumpValue'
  | 'squatRoot'
  | 'squatFill'
  | 'squatValue'
  | 'channels'
  | 'expected'
  | 'rule'
  | 'message';

/**
 * "X-ray": what the game sees right now — recognition speed, the measured
 * values against their thresholds, the gesture state machines and the error-
 * mode rule that fired. Writes to the DOM directly a few times a second, no
 * React renders.
 */
export function XRayPanel({ engine }: { engine: MotionEngine }) {
  const els = useRef<Partial<Record<Slot, HTMLElement | null>>>({});
  const last = useRef(0);
  const slot = useCallback(
    (name: Slot) => (el: HTMLElement | null) => {
      els.current[name] = el;
    },
    [],
  );

  useEngineFrame(engine, (frame) => {
    if (frame.time - last.current < 120) return;
    last.current = frame.time;
    const e = els.current;
    const text = (name: Slot, value: string) => {
      const node = e[name];
      if (node) node.textContent = value;
    };
    const ui = engine.ui.get();
    const s = frame.stats;
    text('rate', `${s.inferenceFps} кадр/с · ${Math.round(s.inferenceMs)} мс · ${ui.backend === 'worker' ? 'отдельный поток' : 'основной поток'}${s.slow ? ' · щадящий режим' : ''}`);
    const b = frame.baseline;
    text('body', b ? `${b.mode === 'full' ? 'всё тело' : 'по пояс'} · ширина плеч ${fmt(b.scale)}` : 'ещё не откалиброван');
    const scheme = schemeOf(b?.mode ?? null);
    text('laneLabel', scheme === 'body' ? 'Полоса — где стоишь' : 'Наклон корпуса');
    text('jumpLabel', scheme === 'body' ? 'Прыжок — подъём тела' : 'Руки вверх');

    const c = frame.classification;
    if (c) {
      // Sideways: ±2.5 thresholds wide, lines at ±threshold.
      const right = c.readings.LEAN_RIGHT;
      const act = right.thresholds.activation;
      const range = act * 2.5;
      const pos = (v: number) => `${50 + Math.max(-50, Math.min(50, (v / range) * 50))}%`;
      if (e.laneDot) e.laneDot.style.left = pos(right.metric);
      if (e.laneLeft) e.laneLeft.style.left = pos(-act);
      if (e.laneRight) e.laneRight.style.left = pos(act);
      if (e.laneRoot) e.laneRoot.dataset.on = String(right.active || c.readings.LEAN_LEFT.active);
      text('laneValue', `${fmt(right.metric)} / ±${fmt(act)}`);
      const bars = [
        ['jump', c.readings.JUMP],
        ['squat', c.readings.CROUCH],
      ] as const;
      for (const [name, reading] of bars) {
        const a = reading.thresholds.activation;
        const share = Math.max(0, Math.min(1, reading.metric / (a * 2)));
        const fill = e[`${name}Fill`];
        const root = e[`${name}Root`];
        if (fill) fill.style.transform = `scaleX(${share})`;
        if (root) root.dataset.on = String(reading.active);
        text(`${name}Value`, `${fmt(reading.metric)} / ${fmt(a)}`);
      }
    }
    text('channels', `в сторону: ${channelText(frame.lateral, frame)} · вверх-вниз: ${channelText(frame.vertical, frame)}`);
    text('expected', frame.expected ? motionMeta(frame.expected, scheme).title : '—');
    const d = frame.diagnosis;
    text('rule', d ? `${d.ruleId} · ${VERDICTS[d.verdict] ?? d.verdict}` : '—');
    if (e.rule) e.rule.dataset.verdict = d?.verdict ?? 'none';
    text('message', d ? `«${d.message}»` : '');
  });

  return (
    <section className="xray" aria-label="Рентген: как игра видит тебя">
      <p className="t-label xray__title">Рентген · как игра видит тебя</p>
      <dl className="xray__facts">
        <dt>Распознавание</dt>
        <dd ref={slot('rate')}>—</dd>
        <dt>Калибровка</dt>
        <dd ref={slot('body')}>—</dd>
      </dl>

      <div className="xray__bar" ref={slot('laneRoot')}>
        <span className="xray__bar-label" ref={slot('laneLabel')}>
          Полоса
        </span>
        <div className="xray__track">
          <i className="xray__mark" ref={slot('laneLeft')} />
          <i className="xray__mark" ref={slot('laneRight')} />
          <div className="xray__dot" ref={slot('laneDot')} />
        </div>
        <span className="xray__value" ref={slot('laneValue')} />
      </div>

      <div className="xray__bar" ref={slot('jumpRoot')}>
        <span className="xray__bar-label" ref={slot('jumpLabel')}>
          Прыжок
        </span>
        <div className="xray__track">
          <div className="xray__fill" ref={slot('jumpFill')} />
          <i className="xray__mark" style={{ left: '50%' }} />
        </div>
        <span className="xray__value" ref={slot('jumpValue')} />
      </div>

      <div className="xray__bar" ref={slot('squatRoot')}>
        <span className="xray__bar-label">Присед — таз вниз</span>
        <div className="xray__track">
          <div className="xray__fill" ref={slot('squatFill')} />
          <i className="xray__mark" style={{ left: '50%' }} />
        </div>
        <span className="xray__value" ref={slot('squatValue')} />
      </div>

      <dl className="xray__facts">
        <dt>Жесты</dt>
        <dd ref={slot('channels')}>—</dd>
        <dt>Игра ждёт</dt>
        <dd ref={slot('expected')}>—</dd>
        <dt>Правило</dt>
        <dd className="xray__rule" ref={slot('rule')}>
          —
        </dd>
      </dl>
      <p className="xray__message" ref={slot('message')} />
    </section>
  );
}
