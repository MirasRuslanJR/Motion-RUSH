import { describe, expect, it } from 'vitest';
import { bootDone, bootProgress, bootStep, type BootStatus } from './bootProgress';

const NOTHING: BootStatus = { fonts: false, art: 0, model: false };
const ALL: BootStatus = { fonts: true, art: 1, model: true };

describe('loading screen progress', () => {
  it('starts at zero and ends at one only when everything is loaded', () => {
    expect(bootProgress(NOTHING, 0)).toBe(0);
    expect(bootProgress(ALL, 0)).toBe(1);
    expect(bootDone(ALL)).toBe(true);
    expect(bootDone({ ...ALL, model: false })).toBe(false);
    expect(bootDone({ ...ALL, art: 0.9 })).toBe(false);
  });

  it('never reaches 100% while the model is still loading', () => {
    const waiting = { ...ALL, model: false };
    expect(bootProgress(waiting, 60_000)).toBeLessThan(0.95);
    expect(bootProgress(waiting, 60_000)).toBeGreaterThan(0.9);
  });

  it('grows with time and with every loaded part', () => {
    const s = { fonts: true, art: 0.5, model: false };
    expect(bootProgress(s, 2000)).toBeGreaterThan(bootProgress(s, 500));
    expect(bootProgress({ ...s, art: 1 }, 500)).toBeGreaterThan(bootProgress(s, 500));
  });

  it('names the first unfinished step', () => {
    expect(bootStep(NOTHING)).toBe('fonts');
    expect(bootStep({ fonts: true, art: 0.3, model: true })).toBe('art');
    expect(bootStep({ fonts: true, art: 1, model: false })).toBe('model');
    expect(bootStep(ALL)).toBe('done');
  });
});
