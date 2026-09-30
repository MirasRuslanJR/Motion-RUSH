import { describe, expect, it } from 'vitest';
import { RENDER_CONFIG } from '../../config/render.config';
import { QualityGovernor } from './quality';

const run = (g: QualityGovernor, frameMs: number, durationMs: number) => {
  for (let t = 0; t < durationMs; t += frameMs) g.update(frameMs);
};

describe('QualityGovernor', () => {
  it('stays high at a steady 60 fps', () => {
    const g = new QualityGovernor();
    run(g, 16.7, 20000);
    expect(g.level).toBe('high');
  });

  it('steps down on sustained slow frames, not on a single hitch', () => {
    const g = new QualityGovernor();
    g.update(150);
    run(g, 16.7, 500);
    expect(g.level).toBe('high');
    run(g, 40, 2500);
    expect(g.level).toBe('medium');
    run(g, 40, 2500);
    expect(g.level).toBe('low');
    run(g, 40, 5000);
    expect(g.level).toBe('low');
  });

  it('ignores stalls such as a tab switch', () => {
    const g = new QualityGovernor();
    for (let i = 0; i < 50; i++) g.update(1000);
    expect(g.level).toBe('high');
  });

  it('steps back up when frames are fast again, waiting longer after each downgrade', () => {
    const g = new QualityGovernor();
    run(g, 40, 2500);
    expect(g.level).toBe('medium');
    const base = RENDER_CONFIG.governor.upgradeAfterMs;
    run(g, 10, base * 1.2);
    expect(g.level).toBe('medium');
    run(g, 10, base * 1.2);
    expect(g.level).toBe('high');
  });

  it('exposes settings for the current level', () => {
    const g = new QualityGovernor();
    expect(g.settings.maxDpr).toBe(RENDER_CONFIG.levels.high.maxDpr);
    run(g, 45, 6000);
    expect(g.settings.glow).toBe(false);
  });
});
