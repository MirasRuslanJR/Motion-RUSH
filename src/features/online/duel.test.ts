import { describe, expect, it, vi } from 'vitest';
import type { DuelLiveState } from './DuelRoom';

/**
 * In-memory stand-in for Supabase Realtime: one topic, presence shared by all
 * subscribers, broadcast delivered to everyone except the sender.
 */
type Handler = (msg: { payload: unknown }) => void;

class FakeChannel {
  readonly broadcast = new Map<string, Handler[]>();
  presenceSync: (() => void) | null = null;
  private readonly bus: FakeBus;
  readonly key: string;
  constructor(bus: FakeBus, key: string) {
    this.bus = bus;
    this.key = key;
  }
  on(type: string, filter: { event: string }, cb: Handler | (() => void)) {
    if (type === 'presence') this.presenceSync = cb as () => void;
    else this.broadcast.set(filter.event, [...(this.broadcast.get(filter.event) ?? []), cb as Handler]);
    return this;
  }
  subscribe(cb: (status: string) => void) {
    this.bus.channels.push(this);
    cb('SUBSCRIBED');
    return this;
  }
  async track(payload: object) {
    this.bus.presence[this.key] = [{ ...payload, presence_ref: this.key }];
    this.bus.sync();
  }
  async send({ event, payload }: { event: string; payload: unknown }) {
    for (const ch of this.bus.channels) if (ch !== this) for (const h of ch.broadcast.get(event) ?? []) h({ payload });
  }
  presenceState() {
    return this.bus.presence;
  }
}

class FakeBus {
  channels: FakeChannel[] = [];
  presence: Record<string, object[]> = {};
  sync() {
    for (const ch of this.channels) ch.presenceSync?.();
  }
  remove(ch: FakeChannel) {
    this.channels = this.channels.filter((c) => c !== ch);
    delete this.presence[ch.key];
    this.sync();
  }
}

let bus = new FakeBus();
vi.mock('../../lib/supabase', () => ({
  supabase: async () => ({
    channel: (_topic: string, opts: { config: { presence: { key: string } } }) => new FakeChannel(bus, opts.config.presence.key),
    removeChannel: async (ch: FakeChannel) => bus.remove(ch),
  }),
}));

const { DuelRoom } = await import('./DuelRoom');
// Deterministic join order.
let clock = 1_000;
vi.spyOn(Date, 'now').mockImplementation(() => (clock += 10));

const live = (score: number): DuelLiveState => ({
  score,
  combo: 0,
  energy: 5,
  progress: 0.5,
  lane: 1,
  airborne: false,
  ducking: false,
  finished: false,
  outcome: null,
  accuracy: null,
});

async function pair() {
  bus = new FakeBus();
  const a = new DuelRoom('ABCD', { id: 'a', name: 'Alice', scheme: 'body' });
  const b = new DuelRoom('ABCD', { id: 'b', name: 'Bob', scheme: 'seated' });
  await a.connect();
  await b.connect();
  return { a, b };
}

describe('online duel room', () => {
  it('both players see each other in the lobby', async () => {
    const { a, b } = await pair();
    expect(a.ui.get().status).toBe('lobby');
    expect(a.ui.get().players.map((p) => p.name)).toEqual(['Alice', 'Bob']);
    expect(b.opponentName).toBe('Alice');
    expect(a.opponentName).toBe('Bob');
  });

  it('starts only when both are ready, with the same course seed for both', async () => {
    const { a, b } = await pair();
    await a.setReady(true);
    expect(a.ui.get().status).toBe('lobby');
    await b.setReady(true);
    expect(a.ui.get().status).toBe('starting');
    expect(b.ui.get().status).toBe('starting');
    expect(a.ui.get().seed).not.toBeNull();
    expect(b.ui.get().seed).toBe(a.ui.get().seed);
    // Readiness resets after the start (a rematch needs a new "ready").
    expect(a.ui.get().players.every((p) => !p.ready)).toBe(true);
  });

  it('relays live state and allows a rematch on a new course', async () => {
    const { a, b } = await pair();
    await a.setReady(true);
    await b.setReady(true);
    const firstSeed = a.ui.get().seed;
    b.sendState(live(700));
    expect(a.ui.get().opponent?.score).toBe(700);
    a.resendLast();
    expect(b.ui.get().opponent).toBeNull();
    a.sendState({ ...live(900), finished: true, outcome: 'complete', accuracy: 0.9 });
    expect(b.ui.get().opponent?.finished).toBe(true);

    await a.rematch();
    await b.rematch();
    expect(a.ui.get().status).toBe('lobby');
    await a.setReady(true);
    await b.setReady(true);
    expect(a.ui.get().status).toBe('starting');
    expect(b.ui.get().seed).toBe(a.ui.get().seed);
    expect(a.ui.get().seed).not.toBe(firstSeed);
  });

  it('turns away a third player and notices when the opponent leaves', async () => {
    const { a, b } = await pair();
    // A late player is turned away even if its random id sorts first.
    const c = new DuelRoom('ABCD', { id: '0', name: 'Carol', scheme: 'body' });
    await c.connect();
    expect(c.ui.get().status).toBe('error');
    expect(c.ui.get().error).toContain('двое');
    expect(a.ui.get().players.map((p) => p.id)).toEqual(['a', 'b']);
    await b.leave();
    expect(a.ui.get().players.map((p) => p.id)).toEqual(['a']);
  });
});
