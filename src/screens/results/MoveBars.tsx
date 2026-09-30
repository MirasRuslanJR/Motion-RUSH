import { Icon } from '../../components/Icon';
import { motionMeta, type ControlScheme } from '../../features/gestures/types';
import type { MoveStats } from '../../features/results/sessionStats';

/** Accuracy per move — horizontal bars with the value at the tip (doubles as the table view). */
export function MoveBars({ moves, scheme }: { moves: MoveStats[]; scheme: ControlScheme }) {
  return (
    <figure className="chart">
      <figcaption className="chart__title">Точность по движениям</figcaption>
      <ul className="bars">
        {moves.map((m) => {
          const meta = motionMeta(m.motion, scheme);
          const pct = Math.round(m.accuracy * 100);
          return (
            <li key={m.motion} className="bars__row">
              <span className="bars__label">
                {meta.arrow ? <Icon name={meta.arrow} size={14} /> : <span className="bars__dot" />}
                {meta.title}
              </span>
              <span className="bars__track" aria-hidden="true">
                <span className="bars__fill" style={{ width: `${Math.max(pct, 1.5)}%` }} />
              </span>
              <span className="bars__value">
                <strong>{pct}%</strong> {m.cleared}/{m.attempts}
                {m.avgLeadMs !== null && (
                  <span className="bars__meta" title="В позиции до подлёта препятствия">
                    {' '}
                    · за {(m.avgLeadMs / 1000).toFixed(1)} с
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
