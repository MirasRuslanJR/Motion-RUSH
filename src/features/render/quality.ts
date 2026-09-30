import { RENDER_CONFIG, type QualityLevel, type QualitySettings } from '../../config/render.config';

const ORDER: QualityLevel[] = ['low', 'medium', 'high'];
type GovernorConfig = typeof RENDER_CONFIG.governor;

/**
 * Watches real frame times and trades visual detail for smoothness:
 * sustained slow frames step quality down quickly, sustained fast frames step it
 * back up slowly — and ever more slowly after each downgrade, so it settles
 * instead of oscillating between two levels.
 */
export class QualityGovernor {
  private readonly cfg: GovernorConfig;
  private current: QualityLevel = 'high';
  private avgFrameMs = 1000 / 60;
  private slowFor = 0;
  private fastFor = 0;
  private downgrades = 0;

  constructor(cfg: GovernorConfig = RENDER_CONFIG.governor) {
    this.cfg = cfg;
  }

  get level(): QualityLevel {
    return this.current;
  }

  get settings(): QualitySettings {
    return RENDER_CONFIG.levels[this.current];
  }

  get averageFrameMs(): number {
    return this.avgFrameMs;
  }

  /** Feed one frame duration. Returns true when the level changed. */
  update(frameMs: number): boolean {
    const c = this.cfg;
    if (frameMs <= 0 || frameMs > c.ignoreFrameMs) return false;
    this.avgFrameMs += c.emaAlpha * (frameMs - this.avgFrameMs);

    const index = ORDER.indexOf(this.current);
    if (this.avgFrameMs > c.downgradeFrameMs) {
      this.fastFor = 0;
      this.slowFor += frameMs;
      if (this.slowFor >= c.downgradeAfterMs && index > 0) {
        this.current = ORDER[index - 1] ?? 'low';
        this.downgrades++;
        this.slowFor = 0;
        return true;
      }
    } else if (this.avgFrameMs < c.upgradeFrameMs) {
      this.slowFor = 0;
      this.fastFor += frameMs;
      const wait = Math.min(c.upgradeAfterMs * 2 ** this.downgrades, c.maxUpgradeAfterMs);
      if (this.fastFor >= wait && index < ORDER.length - 1) {
        this.current = ORDER[index + 1] ?? 'high';
        this.fastFor = 0;
        return true;
      }
    } else {
      this.slowFor = 0;
      this.fastFor = 0;
    }
    return false;
  }
}
