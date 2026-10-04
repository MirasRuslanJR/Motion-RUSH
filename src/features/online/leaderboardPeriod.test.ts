import { describe, expect, it } from 'vitest';
import { comboLayers } from '../../lib/audio/runnerMusic';
import { periodStart } from './globalLeaderboard';

describe('leaderboard periods', () => {
  it('today is the Astana calendar day, the week is the last seven days, all time has no start', () => {
    // 01:30 on 5 October in Astana.
    const now = new Date('2026-10-04T20:30:00Z');
    expect(periodStart('today', now)).toBe('2026-10-05');
    expect(periodStart('week', now)).toBe('2026-09-29');
    expect(periodStart('all', now)).toBeNull();
  });
});

describe('music that follows the player', () => {
  it('a combo of 3, 6 and 10 each adds a layer; a miss (combo 0) takes them all away', () => {
    expect([0, 2, 3, 5, 6, 9, 10, 40].map(comboLayers)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });
});
