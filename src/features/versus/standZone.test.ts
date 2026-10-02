import { describe, expect, it } from 'vitest';
import { StandGuide, STAND_ROOM_SW } from './standZone';

const body = (x: number, sw = 0.2) => ({ shoulderCenter: { x, y: 0.4 }, shoulderWidth: sw });

describe('stand zones for two players', () => {
  it('a zone is the player’s half minus room at the edge and at the middle line', () => {
    const p1 = new StandGuide(0, STAND_ROOM_SW.runner);
    expect(p1.update(body(0.33), 4 / 3)).toBe('ok');
    expect(p1.zone?.x0).toBeCloseTo(0.2);
    expect(p1.zone?.x1).toBeCloseTo(4 / 3 / 2 - 0.2);
    expect(p1.zone?.ok).toBe(true);
    expect(p1.message).toBeNull();

    const p2 = new StandGuide(1, STAND_ROOM_SW.runner);
    expect(p2.update(body(1), 4 / 3)).toBe('ok');
    expect(p2.zone?.x0).toBeCloseTo(4 / 3 / 2 + 0.2);
    expect(p2.zone?.x1).toBeCloseTo(4 / 3 - 0.2);
  });

  it('says which way to move, in the player’s own left / right', () => {
    const p1 = new StandGuide(0, STAND_ROOM_SW.runner);
    expect(p1.update(body(0.1), 4 / 3)).toBe('move-right');
    expect(p1.message).toBe('Сдвинься правее');
    expect(p1.update(body(0.6), 4 / 3)).toBe('move-left');
    expect(p1.message).toBe('Сдвинься левее');
    const p2 = new StandGuide(1, STAND_ROOM_SW.runner);
    expect(p2.update(body(0.72), 4 / 3)).toBe('move-right');
    expect(p2.update(body(1.25), 4 / 3)).toBe('move-left');
  });

  it('does not bounce a player who sways at the edge of their zone', () => {
    const p1 = new StandGuide(0, STAND_ROOM_SW.runner);
    expect(p1.update(body(0.21), 4 / 3)).toBe('ok');
    // 0.02 past the edge (0.1 SW) after having been inside: still fine…
    expect(p1.update(body(0.18), 4 / 3)).toBe('ok');
    // …but a real step out is not.
    expect(p1.update(body(0.12), 4 / 3)).toBe('move-right');
    // And coming back needs to reach the zone itself.
    expect(p1.update(body(0.19), 4 / 3)).toBe('move-right');
  });

  it('dancers need more room, which a 16:9 picture gives them', () => {
    // 2.5 m from a 4:3 camera: half the picture is too narrow for outstretched arms…
    const narrow = new StandGuide(0, STAND_ROOM_SW.dance);
    expect(narrow.update(body(0.33), 4 / 3)).toBe('step-back');
    expect(narrow.zone).toBeNull();
    expect(narrow.message).toBe('Отойди на шаг назад');
    // …the same distance in a 16:9 picture fits.
    const wide = new StandGuide(0, STAND_ROOM_SW.dance);
    expect(wide.update(body(0.44), 16 / 9)).toBe('ok');
    // The runner fits in 4:3 at that distance.
    expect(new StandGuide(0, STAND_ROOM_SW.runner).update(body(0.33), 4 / 3)).toBe('ok');
  });

  it('shows where to stand before the player is seen', () => {
    const p2 = new StandGuide(1, STAND_ROOM_SW.dance);
    expect(p2.update(null, 16 / 9)).toBeNull();
    expect(p2.zone).not.toBeNull();
    expect(p2.zone?.ok).toBe(false);
    expect(p2.message).toBeNull();
  });
});
