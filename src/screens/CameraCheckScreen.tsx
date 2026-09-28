import { useRef, useState } from 'react';
import { CameraViewport } from '../components/CameraViewport';
import { Icon } from '../components/Icon';
import { Ring } from '../components/Ring';
import { setRingProgress } from '../components/ringProgress';
import type { MotionEngine } from '../features/engine/MotionEngine';
import { useEngineFrame, useMotionUi } from '../hooks/useEngine';
import './SetupScreens.css';

const READY_HOLD_MS = 1300;

interface CameraCheckScreenProps {
  engine: MotionEngine;
  onReady: () => void;
}

type CheckState = 'ok' | 'bad' | 'pending' | 'warn';

export function CameraCheckScreen({ engine, onReady }: CameraCheckScreenProps) {
  const camera = useMotionUi(engine, (s) => s.camera);
  const model = useMotionUi(engine, (s) => s.model);
  const delegate = useMotionUi(engine, (s) => s.delegate);
  const tracking = useMotionUi(engine, (s) => s.tracking);
  const message = useMotionUi(engine, (s) => s.trackingMessage);
  const lowLight = useMotionUi(engine, (s) => s.lowLight);
  const multiple = useMotionUi(engine, (s) => s.multiplePeople);
  const [resolution, setResolution] = useState<string | null>(null);
  const circleRef = useRef<SVGCircleElement>(null);
  const readyFor = useRef(0);
  const advanced = useRef(false);

  useEngineFrame(engine, (frame, dt) => {
    if (!resolution && frame.videoWidth) setResolution(`${frame.videoWidth}×${frame.videoHeight}`);
    const ok = frame.trackable && frame.quality.status === 'OK' && !engine.ui.get().multiplePeople;
    readyFor.current = ok ? readyFor.current + dt : Math.max(0, readyFor.current - dt * 2);
    setRingProgress(circleRef.current, readyFor.current / READY_HOLD_MS);
    if (!advanced.current && readyFor.current >= READY_HOLD_MS) {
      advanced.current = true;
      onReady();
    }
  });

  const bodyVisible = tracking !== 'NO_BODY' && tracking !== 'PARTIAL';
  const checks: { icon: Parameters<typeof Icon>[0]['name']; label: string; state: CheckState; detail: string }[] = [
    { icon: 'camera', label: 'Камера', state: camera === 'live' ? 'ok' : 'pending', detail: resolution ?? 'подключение…' },
    {
      icon: 'chip',
      label: 'Модель позы',
      state: model === 'ready' ? 'ok' : model === 'error' ? 'bad' : 'pending',
      detail: model === 'ready' ? `готова · ${delegate ?? ''}` : 'загрузка…',
    },
    {
      icon: 'person',
      label: 'Тело в кадре',
      state: model !== 'ready' ? 'pending' : bodyVisible ? 'ok' : 'bad',
      detail: bodyVisible ? 'голова и плечи видны' : 'не видно',
    },
    {
      icon: 'ruler',
      label: 'Расстояние',
      state: !bodyVisible ? 'pending' : tracking === 'TOO_CLOSE' || tracking === 'TOO_FAR' ? 'bad' : 'ok',
      detail: tracking === 'TOO_CLOSE' ? 'слишком близко' : tracking === 'TOO_FAR' ? 'слишком далеко' : 'отлично',
    },
    { icon: 'sun', label: 'Свет', state: lowLight ? 'warn' : 'ok', detail: lowLight ? 'темновато' : 'хорошо' },
    { icon: 'users', label: 'Один игрок', state: multiple ? 'bad' : 'ok', detail: multiple ? 'в кадре несколько людей' : 'да' },
  ];

  const instruction = multiple
    ? 'Оставь в кадре одного человека'
    : model !== 'ready'
      ? 'Загружаем распознавание позы…'
      : tracking === 'OK'
        ? 'Отлично, тебя видно! Замри на секунду…'
        : message;

  return (
    <main className="screen setup">
      <CameraViewport engine={engine} variant="stage" className="setup__viewport">
        {multiple && (
          <div className="viewport__banner" role="alert">
            <Icon name="users" size={18} /> ONE PLAYER ONLY — оставь в кадре одного человека
          </div>
        )}
      </CameraViewport>

      <aside className="setup__panel">
        <p className="t-label">Шаг 1 · проверка камеры</p>
        <h1 className="t-headline setup__title">Встань в кадр</h1>
        <p className="setup__instruction" aria-live="polite">
          {instruction}
        </p>

        <ul className="checklist">
          {checks.map((c) => (
            <li key={c.label} className={`checklist__item is-${c.state}`}>
              <Icon name={c.icon} size={18} />
              <span className="checklist__label">{c.label}</span>
              <span className="checklist__detail">{c.detail}</span>
              <span className="checklist__state" aria-label={c.state === 'ok' ? 'готово' : 'не готово'}>
                {c.state === 'ok' ? <Icon name="check" size={16} /> : c.state === 'bad' ? <Icon name="cross" size={16} /> : '…'}
              </span>
            </li>
          ))}
        </ul>

        <div className="setup__ready">
          <Ring circleRef={circleRef} size={76} tone="success">
            <Icon name="check" size={24} />
          </Ring>
          <p className="setup__tip">
            Лучше всего 1.5–2.5 м от камеры: видно тело хотя бы до пояса и есть место над головой для рук. Можно играть и сидя.
          </p>
        </div>
        {bodyVisible && (
          <button type="button" className="btn btn--ghost btn--small" onClick={onReady}>
            Продолжить как есть
          </button>
        )}
      </aside>
    </main>
  );
}
