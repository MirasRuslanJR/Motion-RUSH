import { describe, expect, it } from 'vitest';
import { modeArt } from './modeArt';
import { GAME_MODES } from './modes';

describe('modeArt', () => {
  it('gives every mode a cover picture', () => {
    for (const mode of GAME_MODES) expect(modeArt(mode.id)).toBeTruthy();
  });

  it('gives the mini-games, dances and two-player modes their own art', () => {
    const track = modeArt('classic');
    for (const id of ['stars', 'freeze', 'reaction', 'squats', 'dance', 'dance-duo', 'versus', 'duel'] as const) {
      expect(modeArt(id)).not.toBe(track);
    }
    expect(modeArt('dance')).not.toBe(modeArt('dance-duo'));
  });
});
