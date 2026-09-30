import { motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { CameraViewport } from '../../components/CameraViewport';
import { HoldGesture } from '../../components/HoldGesture';
import { Icon } from '../../components/Icon';
import { NicknameField } from '../../components/NicknameField';
import type { MotionEngine } from '../../features/engine/MotionEngine';
import type { SessionResult } from '../../features/gameplay/types';
import { motionMeta, type ControlScheme } from '../../features/gestures/types';
import type { GameModeDef } from '../../features/modes/modes';
import type { DuelRoom } from '../../features/online/DuelRoom';
import { submitScore } from '../../features/online/globalLeaderboard';
import { computeSessionStats, type MoveStats } from '../../features/results/sessionStats';
import { useStore } from '../../lib/store';
import type { Profile, RecordedSession } from '../../lib/storage';
import { ONLINE_ENABLED } from '../../lib/supabase';
import { RollingNumber } from '../game/RollingNumber';
import { MoveBars } from './MoveBars';
import { ScoreTimeline } from './ScoreTimeline';
import './ResultsScreen.css';

interface ResultsScreenProps {
  engine: MotionEngine;
  result: SessionResult;
  mode: GameModeDef;
  recorded: RecordedSession | null;
  profile: Profile;
  duel: DuelRoom | null;
  onProfile: (profile: Profile) => void;
  onPlayAgain: () => void;
  onModes: () => void;
  onRecalibrate: () => void;
  onLeaderboard: () => void;
}

const seconds = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}`;

function MoveCard({ title, move, tone, scheme }: { title: string; move: MoveStats | null; tone: 'good' | 'work'; scheme: ControlScheme }) {
  if (!move) return null;
  const meta = motionMeta(move.motion, scheme);
  return (
    <div className={`move-card move-card--${tone}`}>
      <span className="t-label">{title}</span>
      <span className="move-card__name">
        {meta.arrow && <Icon name={meta.arrow} size={18} />}
        {meta.title}
      </span>
      <span className="move-card__detail">
        {Math.round(move.accuracy * 100)}% · {move.cleared} из {move.attempts}
        {move.avgLeadMs !== null && ` · в позиции за ${(move.avgLeadMs / 1000).toFixed(1)} с`}
      </span>
      {tone === 'work' && <span className="move-card__tip">{meta.cue}</span>}
    </div>
  );
}

/** idle = the request is on its way (it starts as soon as there is a nickname). */
type SubmitState = 'idle' | 'sent' | 'failed';
/** What the global leaderboard needs from a finished run (runner or dance). */
interface RankedRun {
  mode: string;
  score: number;
  bestCombo: number;
  scheme: ControlScheme;
}

/** Results already sent (guards against double effects and remounts). */
const submitted = new WeakSet<RankedRun>();

/** Sends a ranked run to the global leaderboard (asks for a nickname first). */
export function GlobalSubmit({ result, accuracy, profile, onProfile, onLeaderboard }: { result: RankedRun; accuracy: number; profile: Profile; onProfile: (p: Profile) => void; onLeaderboard: () => void }) {
  const [state, setState] = useState<SubmitState>(() => (submitted.has(result) ? 'sent' : 'idle'));
  const name = profile.nickname;

  useEffect(() => {
    if (!ONLINE_ENABLED || name.length < 2 || submitted.has(result)) return;
    submitted.add(result);
    void submitScore({ name, mode: result.mode, score: result.score, accuracy, bestCombo: result.bestCombo, scheme: result.scheme }).then((ok) =>
      setState(ok ? 'sent' : 'failed'),
    );
  }, [name, result, accuracy]);

  if (!ONLINE_ENABLED) return <p className="board__note">Мировой рейтинг не подключён — результат сохранён на этом устройстве.</p>;
  if (name.length < 2) {
    return (
      <div className="global-submit">
        <p className="board__note">Введи ник — и результат попадёт в мировой рейтинг.</p>
        <NicknameField value={name} onSaved={(nickname) => onProfile({ ...profile, nickname })} compact />
      </div>
    );
  }
  return (
    <p className="board__note">
      {state === 'idle' && 'Отправляем в мировой рейтинг…'}
      {state === 'sent' && (
        <>
          Результат <strong>{name}</strong> в мировом рейтинге.{' '}
          <button type="button" className="btn btn--link" onClick={onLeaderboard}>
            Смотреть
          </button>
        </>
      )}
      {state === 'failed' && 'Не удалось отправить результат — проверь интернет.'}
    </p>
  );
}

/** Online duel verdict: waits for the opponent's final state. */
function DuelVerdict({ room, score }: { room: DuelRoom; score: number }) {
  const opponent = useStore(room.ui, (s) => s.opponent);
  const players = useStore(room.ui, (s) => s.players);
  const left = !players.some((p) => p.id !== room.me.id);

  // The opponent may still be running (or may have missed a packet): keep re-sending our final state.
  useEffect(() => {
    room.resendLast();
    const timer = window.setInterval(() => room.resendLast(), 1500);
    return () => window.clearInterval(timer);
  }, [room]);

  const theirs = opponent?.score ?? 0;
  let verdict: string;
  let tone: 'win' | 'lose' | 'wait';
  if (opponent?.finished) {
    verdict = score > theirs ? 'Победа!' : score < theirs ? 'Поражение' : 'Ничья';
    tone = score >= theirs ? 'win' : 'lose';
  } else if (left) {
    verdict = 'Соперник вышел — победа твоя';
    tone = 'win';
  } else {
    verdict = 'Соперник ещё бежит…';
    tone = 'wait';
  }

  return (
    <div className={`duel-verdict duel-verdict--${tone}`} role="status">
      <span className="t-label">Online Duel · комната {room.code}</span>
      <strong className="duel-verdict__title">{verdict}</strong>
      <span className="duel-verdict__scores">
        Ты: <b>{score.toLocaleString('ru-RU')}</b> · {room.opponentName}: <b>{theirs.toLocaleString('ru-RU')}</b>
        {opponent?.finished && opponent.accuracy !== null && ` (${Math.round(opponent.accuracy * 100)}%)`}
      </span>
    </div>
  );
}

export function ResultsScreen({ engine, result, mode, recorded, profile, duel, onProfile, onPlayAgain, onModes, onRecalibrate, onLeaderboard }: ResultsScreenProps) {
  const stats = useMemo(() => computeSessionStats(result), [result]);
  const accuracy = Math.round(stats.accuracy * 100);
  const board = recorded?.profile.leaderboards[result.mode] ?? [];

  useEffect(() => {
    engine.setExpected(null);
  }, [engine]);

  const tiles = [
    { label: 'Лучшее комбо', value: String(result.bestCombo) },
    { label: 'Жестов распознано', value: String(result.gesturesDetected) },
    { label: 'Время сессии', value: seconds(result.durationMs) },
    { label: 'Идеально вовремя', value: `${stats.perfect} из ${stats.total}` },
    {
      label: 'Запас до препятствия',
      value: stats.avgLeadMs === null ? '—' : `${(stats.avgLeadMs / 1000).toFixed(1)} с`,
    },
    { label: 'Бонусы собраны', value: `${result.orbsCollected} из ${result.orbsTotal}` },
  ];

  const headline = result.outcome === 'complete' ? 'трасса пройдена' : mode.energy === 1 ? 'игра окончена' : 'энергия закончилась';
  // A human sentence first — numbers come after.
  const verdict =
    accuracy >= 90
      ? 'Великолепно! Тело слушается тебя идеально.'
      : accuracy >= 70
        ? 'Хороший забег! Ещё чуть-чуть — и будет идеально.'
        : accuracy >= 40
          ? 'Неплохо для начала. Ниже — что получилось и что подтянуть.'
          : 'Разогрелись! Посмотри подсказки ниже и попробуй ещё раз.';

  return (
    <main className="screen results">
      <header className="results__hero">
        <div className="results__headline">
          <p className="t-label">
            {mode.title} · {headline}
          </p>
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
          <p className="results__verdict">{verdict}</p>
          {duel && <DuelVerdict room={duel} score={result.score} />}
        </div>
        <div className="results__actions">
          <CameraViewport engine={engine} variant="pip" hud={false} trail={false} />
          <div className="results__buttons">
            <HoldGesture engine={engine} label={duel ? 'Реванш' : 'Играть снова'} onConfirm={onPlayAgain} />
            <div className="results__links">
              <button type="button" className="btn btn--ghost btn--small" onClick={onModes}>
                Режимы
              </button>
              <button type="button" className="btn btn--ghost btn--small" onClick={onLeaderboard}>
                Рейтинг
              </button>
              <button type="button" className="btn btn--ghost btn--small" onClick={onRecalibrate}>
                Калибровать заново
              </button>
            </div>
          </div>
        </div>
      </header>

      <section className="results__grid">
        <div className="tile tile--hero">
          <span className="t-label">Точность движений</span>
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
            {/* A "best move" at 0% would be a false compliment. */}
            <MoveCard title="Лучше всего получается" move={stats.strongest && stats.strongest.accuracy > 0 ? stats.strongest : null} tone="good" scheme={result.scheme} />
            <MoveCard title="Стоит потренировать" move={stats.needsWork} tone="work" scheme={result.scheme} />
          </div>
          <MoveBars moves={stats.perMove} scheme={result.scheme} />
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
        {mode.ranked && (
          <div className="panel">
            <p className="t-label">Рекорды · {mode.title}</p>
            {board.length > 0 && (
              <ol className="board">
                {board.map((e, i) => (
                  <li key={`${e.date}${i}`} className={recorded?.rank === i + 1 ? 'is-current' : ''}>
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
            )}
            <GlobalSubmit result={result} accuracy={stats.accuracy} profile={profile} onProfile={onProfile} onLeaderboard={onLeaderboard} />
          </div>
        )}
      </section>
    </main>
  );
}
