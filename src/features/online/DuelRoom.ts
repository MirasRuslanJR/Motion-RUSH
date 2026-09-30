import type { RealtimeChannel } from '@supabase/supabase-js';
import { Store } from '../../lib/store';
import { supabase } from '../../lib/supabase';
import type { GameOutcome } from '../gameplay/types';
import type { ControlScheme } from '../gestures/types';

export interface DuelPlayer {
  id: string;
  name: string;
  ready: boolean;
  scheme: ControlScheme;
  /** When the player entered the room: the first two keep their seats. */
  joinedAt: number;
}

/** What each player broadcasts ~5×/s during a duel. */
export interface DuelLiveState {
  score: number;
  combo: number;
  energy: number;
  /** 0..1 of the course. */
  progress: number;
  lane: number;
  airborne: boolean;
  ducking: boolean;
  finished: boolean;
  outcome: GameOutcome | null;
  accuracy: number | null;
}

export type DuelStatus = 'connecting' | 'lobby' | 'starting' | 'error';

export interface DuelUi {
  status: DuelStatus;
  players: DuelPlayer[];
  opponent: DuelLiveState | null;
  seed: number | null;
  error: string | null;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newRoomCode(): string {
  let code = '';
  for (let i = 0; i < 4; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)] ?? 'A';
  return code;
}

export function normalizeRoomCode(input: string): string {
  return input
    .toUpperCase()
    .split('')
    .filter((c) => ALPHABET.includes(c))
    .join('')
    .slice(0, 4);
}

/**
 * Two-player online duel over Supabase Realtime (no database tables needed):
 * presence = who is in the room and ready; broadcast = start signal + live state.
 * Both players race the SAME seeded course; the higher score wins.
 */
export class DuelRoom {
  readonly code: string;
  readonly me: DuelPlayer;
  readonly ui = new Store<DuelUi>({ status: 'connecting', players: [], opponent: null, seed: null, error: null });
  private channel: RealtimeChannel | null = null;
  private started = false;
  private lastState: DuelLiveState | null = null;
  /** Left before the connection finished — do not subscribe. */
  private closed = false;

  constructor(code: string, me: Omit<DuelPlayer, 'ready' | 'joinedAt'>) {
    this.code = code;
    this.me = { ...me, ready: false, joinedAt: Date.now() };
  }

  get opponentName(): string {
    return this.ui.get().players.find((p) => p.id !== this.me.id)?.name ?? 'Соперник';
  }

  async connect(): Promise<void> {
    const db = await supabase();
    if (this.closed) return;
    if (!db) {
      this.ui.set({ status: 'error', error: 'Онлайн не настроен на этом сайте' });
      return;
    }
    const channel = db.channel(`duel:${this.code}`, {
      config: { broadcast: { self: false }, presence: { key: this.me.id } },
    });
    this.channel = channel;
    channel
      .on('presence', { event: 'sync' }, () => this.onPresence())
      .on('broadcast', { event: 'start' }, ({ payload }) => this.onStart(payload as { seed: number }))
      .on('broadcast', { event: 'state' }, ({ payload }) => this.ui.set({ opponent: payload as DuelLiveState }));
    try {
      await new Promise<void>((resolve, reject) => {
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') resolve();
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error(status));
        });
      });
      await channel.track({ ...this.me });
      // Presence may already have turned us away (full room) or started the match.
      if (this.ui.get().status === 'connecting') this.ui.set({ status: 'lobby' });
    } catch {
      this.ui.set({ status: 'error', error: 'Не удалось подключиться к комнате. Проверь интернет.' });
    }
  }

  async setReady(ready: boolean): Promise<void> {
    this.me.ready = ready;
    await this.channel?.track({ ...this.me });
  }

  sendState(state: DuelLiveState): void {
    this.lastState = state;
    void this.channel?.send({ type: 'broadcast', event: 'state', payload: state });
  }

  /** Broadcast is best-effort: the final result is re-sent while the results screen is open. */
  resendLast(): void {
    if (this.lastState) this.sendState(this.lastState);
  }

  /** After a match: back to the lobby for a rematch on a new course. */
  async rematch(): Promise<void> {
    this.started = false;
    this.lastState = null;
    this.ui.set({ status: 'lobby', seed: null, opponent: null });
    await this.setReady(false);
  }

  async leave(): Promise<void> {
    this.closed = true;
    const channel = this.channel;
    this.channel = null;
    if (channel) await (await supabase())?.removeChannel(channel);
  }

  private onPresence(): void {
    const state = this.channel?.presenceState<DuelPlayer>() ?? {};
    const players = Object.values(state)
      .map((list) => list[0])
      .filter((p): p is DuelPlayer & { presence_ref: string } => Boolean(p))
      .map(({ id, name, ready, scheme, joinedAt }) => ({ id, name, ready, scheme, joinedAt }))
      .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
    const seats = players.slice(0, 2);
    if (players.length > 2 && !seats.some((p) => p.id === this.me.id)) {
      this.ui.set({ status: 'error', error: 'В комнате уже двое игроков' });
      void this.leave();
      return;
    }
    this.ui.set({ players: seats });
    // The seated player with the smallest id hosts: when both are ready it picks the course and starts.
    const host = [...seats].sort((a, b) => a.id.localeCompare(b.id))[0];
    if (!this.started && seats.length === 2 && seats.every((p) => p.ready) && host?.id === this.me.id) {
      const seed = Math.floor(Math.random() * 0xffffffff) >>> 0;
      void this.channel?.send({ type: 'broadcast', event: 'start', payload: { seed } });
      this.onStart({ seed });
    }
  }

  private onStart(payload: { seed: number }): void {
    if (this.started) return;
    this.started = true;
    this.ui.set({ status: 'starting', seed: payload.seed, opponent: null });
    // Readiness is per match: nobody is "ready" for the rematch until they say so again.
    void this.setReady(false);
  }
}
