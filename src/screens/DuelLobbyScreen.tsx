import { useEffect, useState } from 'react';
import { CameraViewport } from '../components/CameraViewport';
import { HoldGesture } from '../components/HoldGesture';
import { Icon } from '../components/Icon';
import type { MotionEngine } from '../features/engine/MotionEngine';
import { normalizeRoomCode, type DuelRoom } from '../features/online/DuelRoom';
import { useStore } from '../lib/store';
import './DuelLobbyScreen.css';

interface DuelLobbyScreenProps {
  engine: MotionEngine;
  room: DuelRoom | null;
  /** Code from an invite link (?room=CODE). */
  initialCode?: string;
  onCreate: () => void;
  onJoin: (code: string) => void;
  onLeave: () => void;
  onStart: (seed: number) => void;
}

function inviteLink(code: string): string {
  return `${location.origin}${location.pathname}?room=${code}`;
}

function RoomView({ engine, room, onLeave, onStart }: { engine: MotionEngine; room: DuelRoom; onLeave: () => void; onStart: (seed: number) => void }) {
  const [copied, setCopied] = useState(false);
  const status = useStore(room.ui, (s) => s.status);
  const players = useStore(room.ui, (s) => s.players);
  const seed = useStore(room.ui, (s) => s.seed);
  const error = useStore(room.ui, (s) => s.error);
  const me = players.find((p) => p.id === room.me.id);
  const opponent = players.find((p) => p.id !== room.me.id);

  useEffect(() => {
    if (status === 'starting' && seed !== null) onStart(seed);
  }, [status, seed, onStart]);

  if (status === 'error') {
    return (
      <div className="lobby__card">
        <p className="lobby__error">{error}</p>
        <button type="button" className="btn btn--ghost" onClick={onLeave}>
          Назад
        </button>
      </div>
    );
  }

  return (
    <div className="lobby__card">
      <p className="t-label">Код комнаты — скажи его сопернику</p>
      <p className="lobby__code" aria-live="polite">
        {room.code}
      </p>
      <button
        type="button"
        className="btn btn--ghost btn--small"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(inviteLink(room.code))
            .then(() => setCopied(true))
            .catch(() => undefined);
        }}
      >
        {copied ? 'Ссылка скопирована — отправь сопернику' : 'Скопировать ссылку-приглашение'}
      </button>
      {status === 'connecting' && <p className="lobby__hint">Подключаемся…</p>}
      <ul className="lobby__players">
        {[me ?? { ...room.me }, opponent].map((p, i) => (
          <li key={p?.id ?? `empty-${i}`} className={p?.ready ? 'is-ready' : ''}>
            <span className="lobby__dot" />
            <span className="lobby__name">{p ? `${p.name}${p.id === room.me.id ? ' (ты)' : ''}` : 'Ждём соперника…'}</span>
            <span className="lobby__state">{p ? (p.ready ? 'готов' : 'не готов') : ''}</span>
          </li>
        ))}
      </ul>
      {status === 'lobby' && (
        <div className="lobby__actions">
          {me?.ready ? (
            <button type="button" className="btn btn--ghost" onClick={() => void room.setReady(false)}>
              Отменить готовность
            </button>
          ) : (
            <HoldGesture engine={engine} label="Я готов" onConfirm={() => void room.setReady(true)} />
          )}
          <p className="lobby__hint">
            {opponent ? 'Игра начнётся, когда оба будут готовы.' : 'Пусть соперник откроет MOTION//RUSH → Online Duel → «Войти по коду».'}
          </p>
        </div>
      )}
      <button type="button" className="btn btn--link" onClick={onLeave}>
        Выйти из комнаты
      </button>
    </div>
  );
}

/** Online duel lobby: create a room or join one by its 4-letter code. */
export function DuelLobbyScreen({ engine, room, initialCode = '', onCreate, onJoin, onLeave, onStart }: DuelLobbyScreenProps) {
  const [code, setCode] = useState(() => normalizeRoomCode(initialCode));

  useEffect(() => {
    engine.setExpected(null);
  }, [engine]);

  return (
    <main className="screen lobby">
      <aside className="lobby__side">
        <CameraViewport engine={engine} variant="pip" hud={false} />
        <p className="lobby__hint">Оба игрока проходят одну и ту же трассу одновременно. Ты видишь соперника на соседней дорожке — кто наберёт больше очков, тот победил.</p>
      </aside>
      <section className="lobby__main">
        <p className="t-label">Online Duel</p>
        <h1 className="t-headline">Гонка 1 на 1</h1>
        {room ? (
          <RoomView engine={engine} room={room} onLeave={onLeave} onStart={onStart} />
        ) : (
          <div className="lobby__card">
            <button type="button" className="btn btn--primary" onClick={onCreate}>
              <Icon name="users" size={18} /> Создать комнату
            </button>
            <form
              className="lobby__join"
              onSubmit={(e) => {
                e.preventDefault();
                if (code.length === 4) onJoin(code);
              }}
            >
              <input
                className="nick__input lobby__code-input"
                value={code}
                onChange={(e) => setCode(normalizeRoomCode(e.target.value))}
                placeholder="КОД"
                aria-label="Код комнаты"
                inputMode="text"
                autoCapitalize="characters"
              />
              <button type="submit" className="btn btn--ghost" disabled={code.length !== 4}>
                Войти по коду
              </button>
            </form>
            <button type="button" className="btn btn--link" onClick={onLeave}>
              Назад к режимам
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
