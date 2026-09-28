import { motion } from 'motion/react';
import { useEffect, useMemo } from 'react';
import { CameraViewport } from '../../components/CameraViewport';
import { HoldGesture } from '../../components/HoldGesture';
import { Icon } from '../../components/Icon';
import type { MotionEngine } from '../../features/engine/MotionEngine';
import type { SessionResult } from '../../features/gameplay/types';
import { MOTION_META } from '../../features/gestures/types';
import { computeSessionStats, type MoveStats } from '../../features/results/sessionStats';
import type { RecordedSession } from '../../lib/storage';
import { RollingNumber } from '../game/RollingNumber';
import { MoveBars } from './MoveBars';
import { ScoreTimeline } from './ScoreTimeline';
import './ResultsScreen.css';

interface ResultsScreenProps {
  engine: MotionEngine;
  result: SessionResult;
  recorded: RecordedSession | null;
  onPlayAgain: () => void;
  onRecalibrate: () => void;
}

const seconds = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}`;

function MoveCard({ title, move, tone }: { title: string; move: MoveStats | null; tone: 'good' | 'work' }) {
  if (!move) return null;
  const meta = MOTION_META[move.motion];
  return (
    <div className={`move-card move-card--${tone}`}>
      <span className="t-label">{title}</span>
      <span className="move-card__name">
        {meta.arrow && <Icon name={meta.arrow} size={18} />}
        {meta.title}
      </span>
      <span className="move-card__detail">
        {Math.round(move.accuracy * 100)}% · {move.cleared} из {move.attempts}
        {move.avgReactionMs !== null && ` · реакция ${(move.avgReactionMs / 1000).toFixed(1)} с`}
      </span>
      {tone === 'work' && <span className="move-card__tip">{meta.cue}</span>}
    </div>
  );
}

export function ResultsScreen({ engine, result, recorded, onPlayAgain, onRecalibrate }: ResultsScreenProps) {
  const stats = useMemo(() => computeSessionStats(result), [result]);
  const accuracy = Math.round(stats.accuracy * 100);

  useEffect(() => {
    engine.setExpected(null);
  }, [engine]);

  const tiles = [
    { label: 'Лучшее комбо', value: String(result.bestCombo) },
    { label: 'Жестов распознано', value: String(result.gesturesDetected) },
    { label: 'Время сессии', value: seconds(result.durationMs) },
    { label: 'Perfect', value: `${stats.perfect} из ${stats.total}` },
    {
      label: 'Средняя реакция',
      value: stats.avgReactionMs === null ? '—' : `${(stats.avgReactionMs / 1000).toFixed(2)} с`,
    },
    { label: 'Энергосферы', value: `${result.orbsCollected} из ${result.orbsTotal}` },
  ];

  return (
    <main className="screen results">
      <header className="results__hero">
        <div className="results__headline">
          <p className="t-label">{result.outcome === 'complete' ? 'Motion complete' : 'Out of energy'}</p>
          <motion.div
            className="results__score"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <RollingNumber value={result.score} duration={1.2} />
          </motion.div>
          <p className="results__score-caption">
            очков
            {recorded?.isNewBest && <span className="badge badge--success">Новый рекорд</span>}
            {recorded?.rank && !recorded.isNewBest && <span className="badge">#{recorded.rank} в твоей таблице</span>}
          </p>
        </div>
        <div className="results__actions">
          <CameraViewport engine={engine} variant="pip" hud={false} trail={false} />
          <div className="results__buttons">
            <HoldGesture engine={engine} label="Играть снова" onConfirm={onPlayAgain} />
            <button type="button" className="btn btn--ghost btn--small" onClick={onRecalibrate}>
              Калибровать заново
            </button>
          </div>
        </div>
      </header>

      <section className="results__grid">
        <div className="tile tile--hero">
          <span className="t-label">Motion accuracy</span>
          <span className="tile__hero-value">{accuracy}%</span>
          <span className="tile__sub">
            {stats.cleared} из {stats.total} препятствий пройдено правильным движением
          </span>
          <span className="tile__meter" aria-hidden="true">
            <span style={{ width: `${accuracy}%` }} />
          </span>
        </div>
        {tiles.map((t) => (
          <div key={t.label} className="tile">
            <span className="t-label">{t.label}</span>
            <span className="tile__value">{t.value}</span>
          </div>
        ))}
      </section>

      <section className="results__row">
        <div className="panel">
          <div className="move-cards">
            <MoveCard title="Your strongest move" move={stats.strongest} tone="good" />
            <MoveCard title="Needs work" move={stats.needsWork} tone="work" />
          </div>
          <MoveBars moves={stats.perMove} />
        </div>

        <div className="panel">
          <p className="t-label">Режим «ошибка»</p>
          <h2 className="panel__title">Что заметила система</h2>
          <p className="panel__lead">
            Подсказок показано: <strong>{stats.hintsShown}</strong> · исправлено после подсказки:{' '}
            <strong>{stats.errorsCorrected}</strong>
          </p>
          {stats.topMistakes.length > 0 ? (
            <ol className="mistakes">
              {stats.topMistakes.map((m) => (
                <li key={`${m.ruleId}${m.message}`}>
                  <span className="mistakes__count">×{m.count}</span>
                  <span>{m.message}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="panel__empty">Ни одного промаха — все движения засчитаны.</p>
          )}
        </div>
      </section>

      <section className="results__row">
        <div className="panel panel--chart">
          <ScoreTimeline result={result} />
        </div>
        {recorded && recorded.profile.leaderboard.length > 0 && (
          <div className="panel">
            <p className="t-label">Локальная таблица рекордов</p>
            <ol className="board">
              {recorded.profile.leaderboard.map((e, i) => (
                <li key={`${e.date}${i}`} className={recorded.rank === i + 1 ? 'is-current' : ''}>
                  <span className="board__rank">{i + 1}</span>
                  <span className="board__score">{e.score.toLocaleString('ru-RU')}</span>
                  <span className="board__meta">
                    {Math.round(e.accuracy * 100)}% · комбо {e.bestCombo}
                  </span>
                  <span className="board__date">
                    {new Date(e.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                  </span>
                </li>
              ))}
            </ol>
            <p className="board__note">Хранится только в этом браузере.</p>
          </div>
        )}
      </section>
    </main>
  );
}
