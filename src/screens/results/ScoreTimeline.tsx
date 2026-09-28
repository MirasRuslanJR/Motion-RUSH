import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { SessionResult } from '../../features/gameplay/types';

const HEIGHT = 190;
const M = { top: 14, right: 64, bottom: 26, left: 48 };

function niceStep(max: number, ticks = 4): number {
  const raw = Math.max(max, 1) / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

const fmt = (v: number) => v.toLocaleString('ru-RU');
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** Score over game time — one series, one axis, misses marked on the time axis. */
export function ScoreTimeline({ result }: { result: SessionResult }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => setWidth(Math.max(260, host.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const points = result.timeline;
  const misses = result.obstacles.filter((o) => o.result === 'miss');
  const maxT = Math.max(points[points.length - 1]?.t ?? 1, 1);
  const step = niceStep(Math.max(...points.map((p) => p.score), 1));
  const maxY = Math.ceil(Math.max(...points.map((p) => p.score), 1) / step) * step;
  const plotW = width - M.left - M.right;
  const plotH = HEIGHT - M.top - M.bottom;
  const x = (t: number) => M.left + (t / maxT) * plotW;
  const y = (v: number) => M.top + plotH - (v / maxY) * plotH;

  const last = points[points.length - 1];
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.score).toFixed(1)}`).join('');
  const area = last ? `${line}L${x(last.t).toFixed(1)},${y(0)}L${x(0)},${y(0)}Z` : '';

  const yTicks = Array.from({ length: Math.round(maxY / step) + 1 }, (_, i) => i * step);
  const xStep = maxT > 60 ? 20 : 10;
  const xTicks = Array.from({ length: Math.floor(maxT / xStep) + 1 }, (_, i) => i * xStep);
  const hovered = hover !== null ? points[hover] : undefined;

  const onPointer = (e: PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - rect.left) / rect.width) * maxT;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(p.t - t) < Math.abs((points[best]?.t ?? 0) - t)) best = i;
    });
    setHover(best);
  };

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const current = hover ?? points.length - 1;
    setHover(Math.min(points.length - 1, Math.max(0, current + (e.key === 'ArrowRight' ? 1 : -1))));
  };

  return (
    <figure className="chart" ref={hostRef}>
      <figcaption className="chart__title">
        Очки по ходу забега
        <span className="chart__legend">
          <span className="chart__key chart__key--miss" aria-hidden="true">✕</span> промах
        </span>
      </figcaption>
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={`График очков: итог ${fmt(result.score)} за ${clock(maxT)}. Стрелками можно пройти по точкам.`}
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line className="chart__grid" x1={M.left} x2={M.left + plotW} y1={y(v)} y2={y(v)} />
            <text className="chart__tick" x={M.left - 8} y={y(v)} textAnchor="end" dominantBaseline="middle">
              {fmt(v)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} className="chart__tick" x={x(t)} y={HEIGHT - 6} textAnchor="middle">
            {clock(t)}
          </text>
        ))}
        <path className="chart__area" d={area} />
        <path className="chart__line" d={line} />
        {misses.map((m) => (
          <text key={m.id} className="chart__miss" x={x(m.arriveAt / 1000)} y={y(0) - 4} textAnchor="middle">
            ✕
          </text>
        ))}
        {last && (
          <>
            <circle className="chart__dot" cx={x(last.t)} cy={y(last.score)} r={4} />
            <text className="chart__end" x={x(last.t) + 10} y={y(last.score)} dominantBaseline="middle">
              {fmt(last.score)}
            </text>
          </>
        )}
        {hovered && (
          <g pointerEvents="none">
            <line className="chart__cross" x1={x(hovered.t)} x2={x(hovered.t)} y1={M.top} y2={M.top + plotH} />
            <circle className="chart__dot" cx={x(hovered.t)} cy={y(hovered.score)} r={4.5} />
          </g>
        )}
        <rect
          x={M.left}
          y={M.top}
          width={plotW}
          height={plotH}
          fill="transparent"
          onPointerMove={onPointer}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {hovered && (
        <div
          className="chart__tooltip"
          style={{ left: Math.min(x(hovered.t) + 12, width - 150), top: Math.max(y(hovered.score) - 44, 0) }}
          aria-hidden="true"
        >
          <span className="chart__tooltip-time">{clock(hovered.t)}</span>
          <strong>{fmt(hovered.score)}</strong> очков
        </div>
      )}
      <table className="sr-only">
        <caption>Очки по секундам</caption>
        <thead>
          <tr>
            <th scope="col">Время</th>
            <th scope="col">Очки</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.t}>
              <td>{clock(p.t)}</td>
              <td>{p.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
