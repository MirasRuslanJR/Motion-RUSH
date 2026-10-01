import { useEffect, useState, type CSSProperties } from 'react';
import { Icon } from '../components/Icon';
import { fetchTopScores, type GlobalScore } from '../features/online/globalLeaderboard';
import { GAME_MODES, type GameModeId } from '../features/modes/modes';
import type { Profile } from '../lib/storage';
import { ONLINE_ENABLED } from '../lib/supabase';
import './LeaderboardScreen.css';

const RANKED = GAME_MODES.filter((m) => m.ranked);

interface LeaderboardScreenProps {
  profile: Profile;
  initialMode: GameModeId;
  onBack: () => void;
}

type Load = { state: 'loading' } | { state: 'ready'; rows: GlobalScore[] } | { state: 'offline' };

export function LeaderboardScreen({ profile, initialMode, onBack }: LeaderboardScreenProps) {
  const [mode, setMode] = useState<GameModeId>(RANKED.some((m) => m.id === initialMode) ? initialMode : 'classic');
  const [period, setPeriod] = useState<'all' | 'today'>(initialMode === 'daily' ? 'today' : 'all');
  const [load, setLoad] = useState<Load>(ONLINE_ENABLED ? { state: 'loading' } : { state: 'offline' });

  useEffect(() => {
    if (!ONLINE_ENABLED) return;
    let alive = true;
    fetchTopScores(mode, period).then((rows) => {
      if (alive) setLoad(rows ? { state: 'ready', rows } : { state: 'offline' });
    });
    return () => {
      alive = false;
    };
  }, [mode, period]);

  const local = profile.leaderboards[mode] ?? [];

  return (
    <main className="screen board-screen">
      <header className="board-screen__head">
        <div>
          <p className="t-label">Рейтинг игроков</p>
          <h1 className="t-headline">Лучшие результаты</h1>
        </div>
        <button type="button" className="btn btn--ghost btn--small" onClick={onBack}>
          <Icon name="left" size={16} /> Назад
        </button>
      </header>

      <div className="board-screen__tabs" role="tablist">
        {RANKED.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={m.id === mode}
            className={`tab ${m.id === mode ? 'is-active' : ''}`}
            style={{ '--accent': m.accent } as CSSProperties}
            onClick={() => {
              setMode(m.id);
              if (ONLINE_ENABLED) setLoad({ state: 'loading' });
            }}
          >
            {m.title}
          </button>
        ))}
      </div>

      <div className="board-screen__grid">
        <section className="panel">
          <div className="board-screen__panel-head">
            <p className="t-label">Весь мир</p>
            <div className="segmented" role="group" aria-label="Период">
              {(['all', 'today'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={p === period ? 'is-active' : ''}
                  onClick={() => {
                    setPeriod(p);
                    if (ONLINE_ENABLED) setLoad({ state: 'loading' });
                  }}
                >
                  {p === 'all' ? 'Всё время' : 'Сегодня'}
                </button>
              ))}
            </div>
          </div>
          {load.state === 'offline' && (
            <p className="board-screen__empty">Мировой рейтинг появится, когда на сайте подключат онлайн (Supabase).</p>
          )}
          {load.state === 'loading' && <p className="board-screen__empty">Загружаем…</p>}
          {load.state === 'ready' && load.rows.length === 0 && (
            <p className="board-screen__empty">Пока пусто — стань первым!</p>
          )}
          {load.state === 'ready' && load.rows.length > 0 && (
            <ol className="board board--global">
              {load.rows.map((r, i) => (
                <li key={`${r.created_at}${i}`} className={r.name === profile.nickname ? 'is-current' : ''}>
                  <span className="board__rank">{i + 1}</span>
                  <span className="board__score">
                    {r.name}
                    <small>{r.score.toLocaleString('ru-RU')}</small>
                  </span>
                  <span className="board__meta">
                    {Math.round(r.accuracy * 100)}% · комбо {r.best_combo}
                  </span>
                  <span className="board__date">{r.scheme === 'body' ? 'стоя' : 'сидя'}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="panel">
          <p className="t-label">На этом устройстве</p>
          {local.length === 0 ? (
            <p className="board-screen__empty">Ещё нет забегов в этом режиме.</p>
          ) : (
            <ol className="board">
              {local.map((e, i) => (
                <li key={`${e.date}${i}`}>
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
        </section>
      </div>
    </main>
  );
}
