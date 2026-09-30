export type QualityLevel = 'high' | 'medium' | 'low';

export interface QualitySettings {
  /** Upper bound for canvas devicePixelRatio. */
  maxDpr: number;
  /** Wide translucent "glow" strokes under bones / beams. */
  glow: boolean;
  /** Particle count multiplier. */
  particles: number;
  /** Motion-trail samples kept per joint. */
  trailLength: number;
  /** Minimum time between camera-overlay redraws (it also redraws on every new pose). */
  overlayIntervalMs: number;
}

/** RENDER_CONFIG — adaptive rendering quality for weak (integrated) GPUs. */
export const RENDER_CONFIG = {
  /**
   * Poses arrive at the inference rate (~12–30 Hz); the drawn skeleton and runner
   * glide toward each new pose with this time constant, so motion looks fluid at
   * 60 fps. Recognition always uses the raw (unsmoothed-for-display) pose.
   */
  displaySmoothingMs: 45,
  levels: {
    high: { maxDpr: 1.5, glow: true, particles: 1, trailLength: 12, overlayIntervalMs: 16 },
    medium: { maxDpr: 1.25, glow: true, particles: 0.6, trailLength: 8, overlayIntervalMs: 33 },
    low: { maxDpr: 1, glow: false, particles: 0.35, trailLength: 5, overlayIntervalMs: 33 },
  } satisfies Record<QualityLevel, QualitySettings>,
  governor: {
    /** Smoothing of the frame-time average (per frame). */
    emaAlpha: 0.08,
    /** Frames longer than this are stalls (tab switch, GC) and are ignored. */
    ignoreFrameMs: 200,
    /** Average frame above this for `downgradeAfterMs` → step down. */
    downgradeFrameMs: 22,
    downgradeAfterMs: 1500,
    /** Average frame below this for `upgradeAfterMs` → step up… */
    upgradeFrameMs: 15,
    upgradeAfterMs: 5000,
    /** …and every downgrade doubles the wait before upgrading again (anti-oscillation). */
    maxUpgradeAfterMs: 60000,
  },
};
