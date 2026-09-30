import { describe, expect, it, vi } from 'vitest';

/** Minimal in-memory Realtime: one topic, shared presence, broadcast to everyone else. */
type Handler = (msg: { payload: unknown }) => void;

class Bus {
  channels: Channel[] = [];
  presence: Record<string, object[]> = {};
  sync() {
    for (const ch of [...this.channels]) ch.presenceSync?.();
  }
}

class Channel {
  presenceSync: (() => void) | null = null;
  readonly handlers = new Map<string, Handler>();
  readonly bus: Bus;
  readonly key: string;
  constructor(bus: Bus, key: string) {
    this.bus = bus;
    this.key = key;
  }
  on(type: string, filter: { event: string }, cb: Handler | (() => void)) {
    if (type === 'presence') this.presenceSync = cb as () => void;
    else this.handlers.set(filter.event, cb as Handler);
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
    for (const ch of this.bus.channels) if (ch !== this) ch.handlers.get(event)?.({ payload });
  }
  presenceState() {
    return this.bus.presence;
  }
}

let bus = new Bus();
vi.mock('../../lib/supabase', () => ({
  supabase: async () => ({
    channel: (_topic: string, opts: { config: { presence: { key: string } } }) => new Channel(bus, opts.config.presence.key),
    removeChannel: async (ch: Channel) => {
      bus.channels = bus.channels.filter((c) => c !== ch);
      delete bus.presence[ch.key];
      bus.sync();
    },
  }),
}));

const { QuickMatch } = await import('./QuickMatch');
let clock = 5_000;
vi.spyOn(Date, 'now').mockImplementation(() => (clock += 10));

describe('quick match', () => {
  it('pairs the two players who waited longest into the same room', async () => {
    bus = new Bus();
    const a = new QuickMatch({ id: 'a', name: 'Alice' }).find();
    const b = new QuickMatch({ id: 'b', name: 'Bob' }).find();
    const [ca, cb] = await Promise.all([a, b]);
    expect(ca).toMatch(/^[A-Z2-9]{4}$/);
    expect(cb).toBe(ca);
    // Both left the waiting room.
    expect(bus.channels).toHaveLength(0);
  });

  it('a lone player keeps waiting until cancelled', async () => {
    bus = new Bus();
    const q = new QuickMatch({ id: 'solo', name: 'Solo' });
    const found = q.find();
    await Promise.resolve();
    await q.cancel();
    await expect(found).resolves.toBeNull();
  });
});
