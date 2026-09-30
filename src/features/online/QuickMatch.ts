import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { newRoomCode } from './DuelRoom';

interface Seeker {
  id: string;
  name: string;
  joinedAt: number;
}

/**
 * Quick match: players who pressed "find an opponent" wait in one shared
 * Realtime channel. The two who have waited longest are paired: the earlier
 * one picks a room code and tells the other; both then join that DuelRoom.
 */
export class QuickMatch {
  private channel: RealtimeChannel | null = null;
  private done = false;
  private readonly me: Seeker;

  constructor(me: { id: string; name: string }) {
    this.me = { ...me, joinedAt: Date.now() };
  }

  /** Resolves with a room code once paired (null if online is unavailable or cancelled). */
  async find(): Promise<string | null> {
    const db = await supabase();
    if (!db || this.done) return null;
    return new Promise<string | null>((resolve) => {
      const finish = (code: string | null) => {
        if (this.done) return;
        this.done = true;
        void this.cancel();
        resolve(code);
      };
      this.onCancel = () => resolve(null);
      const channel = db.channel('quickmatch:v1', { config: { broadcast: { self: false }, presence: { key: this.me.id } } });
      this.channel = channel;
      channel
        .on('presence', { event: 'sync' }, () => {
          const state = channel.presenceState<Seeker>();
          const seekers = Object.values(state)
            .map((list) => list[0])
            .filter((s): s is Seeker & { presence_ref: string } => Boolean(s))
            .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
          const [first, second] = seekers;
          if (first?.id === this.me.id && second) {
            const code = newRoomCode();
            // Leave only after the message is out, or the partner would never hear about the room.
            void channel.send({ type: 'broadcast', event: 'match', payload: { host: this.me.id, guest: second.id, code } }).finally(() => finish(code));
          }
        })
        .on('broadcast', { event: 'match' }, ({ payload }) => {
          const match = payload as { host: string; guest: string; code: string };
          if (match.guest === this.me.id) finish(match.code);
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') void channel.track({ ...this.me });
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') finish(null);
        });
    });
  }

  private onCancel: (() => void) | null = null;

  async cancel(): Promise<void> {
    const wasDone = this.done;
    this.done = true;
    const channel = this.channel;
    this.channel = null;
    if (channel) await (await supabase())?.removeChannel(channel);
    if (!wasDone) this.onCancel?.();
  }
}
