/**
 * Temporal filters for noisy realtime signals.
 *
 * OneEuroFilter (Casiez et al., CHI 2012) adapts its cutoff to the signal speed:
 * strong smoothing when the body is still (kills landmark jitter), low lag when
 * the body moves fast (keeps controls responsive).
 */

export interface OneEuroParams {
  /** Minimum cutoff frequency, Hz. Lower = smoother at rest. */
  minCutoff: number;
  /** Speed coefficient. Higher = less lag during fast motion. */
  beta: number;
  /** Cutoff for the derivative estimate, Hz. */
  dCutoff: number;
}

function smoothingFactor(dtSeconds: number, cutoffHz: number): number {
  const r = 2 * Math.PI * cutoffHz * dtSeconds;
  return r / (r + 1);
}

export class OneEuroFilter {
  private params: OneEuroParams;
  private value = 0;
  private derivative = 0;
  private lastTimeMs = 0;
  private initialized = false;

  constructor(params: OneEuroParams) {
    this.params = params;
  }

  /** New tuning from the next sample on; the filtered value carries over (no jump). */
  setParams(params: OneEuroParams): void {
    this.params = params;
  }

  reset(): void {
    this.initialized = false;
  }

  filter(raw: number, timeMs: number): number {
    if (!this.initialized) {
      this.initialized = true;
      this.value = raw;
      this.derivative = 0;
      this.lastTimeMs = timeMs;
      return raw;
    }
    const dt = Math.max((timeMs - this.lastTimeMs) / 1000, 1e-3);
    this.lastTimeMs = timeMs;

    const rawDerivative = (raw - this.value) / dt;
    this.derivative += smoothingFactor(dt, this.params.dCutoff) * (rawDerivative - this.derivative);

    const cutoff = this.params.minCutoff + this.params.beta * Math.abs(this.derivative);
    this.value += smoothingFactor(dt, cutoff) * (raw - this.value);
    return this.value;
  }
}

/** Time-constant based exponential moving average (frame-rate independent). */
export class Ema {
  private readonly tauMs: number;
  private current = 0;
  private lastTimeMs = 0;
  private initialized = false;

  constructor(tauMs: number) {
    this.tauMs = tauMs;
  }

  get value(): number {
    return this.current;
  }

  reset(): void {
    this.initialized = false;
  }

  update(sample: number, timeMs: number): number {
    if (!this.initialized) {
      this.initialized = true;
      this.current = sample;
      this.lastTimeMs = timeMs;
      return sample;
    }
    const dt = Math.max(timeMs - this.lastTimeMs, 0);
    this.lastTimeMs = timeMs;
    const alpha = 1 - Math.exp(-dt / this.tauMs);
    this.current += alpha * (sample - this.current);
    return this.current;
  }
}
