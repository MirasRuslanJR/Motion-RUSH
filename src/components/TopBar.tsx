import { SETUP_STEPS, type Phase } from '../app/flow';
import { Icon } from './Icon';

interface TopBarProps {
  phase: Phase;
  muted: boolean;
  onToggleMute: () => void;
  onHome: () => void;
}

export function TopBar({ phase, muted, onToggleMute, onHome }: TopBarProps) {
  const stepIndex = SETUP_STEPS.findIndex((s) => s.phase === phase);
  const showSteps = stepIndex >= 0 && phase !== 'game';

  return (
    <header className={`topbar ${phase === 'game' ? 'topbar--game' : ''}`}>
      <button type="button" className="brand" onClick={onHome} aria-label="MOTION//RUSH — на главную">
        <span className="brand__mark" aria-hidden="true" />
        MOTION<span className="brand__slash">//</span>RUSH
      </button>
      {showSteps && (
        <ol className="steps" aria-label="Шаги подготовки">
          {SETUP_STEPS.map((s, i) => (
            <li key={s.phase} className={i < stepIndex ? 'is-done' : i === stepIndex ? 'is-current' : ''} aria-current={i === stepIndex ? 'step' : undefined}>
              <span className="steps__num">{i + 1}</span>
              <span className="steps__label">{s.label}</span>
            </li>
          ))}
        </ol>
      )}
      <button
        type="button"
        className="icon-btn"
        onClick={onToggleMute}
        aria-label={muted ? 'Включить звук' : 'Выключить звук'}
        aria-pressed={!muted}
      >
        <Icon name={muted ? 'mute' : 'sound'} size={20} />
      </button>
    </header>
  );
}
