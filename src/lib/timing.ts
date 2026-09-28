/** Counts events per second over a sliding one-second window. */
export class RateMeter {
  private count = 0;
  private windowStart = 0;
  private current = 0;

  get rate(): number {
    return this.current;
  }

  tick(now: number): void {
    if (this.windowStart === 0) this.windowStart = now;
    this.count++;
    const elapsed = now - this.windowStart;
    if (elapsed >= 1000) {
      this.current = Math.round((this.count * 1000) / elapsed);
      this.count = 0;
      this.windowStart = now;
    }
  }
}

/** A value only changes after the new value has persisted for `delayMs`. */
export class Debounced<T> {
  private readonly delayMs: number;
  private stable: T;
  private pending: T;
  private pendingSince = 0;

  constructor(initial: T, delayMs: number) {
    this.stable = initial;
    this.pending = initial;
    this.delayMs = delayMs;
  }

  get value(): T {
    return this.stable;
  }

  update(next: T, now: number): T {
    if (Object.is(next, this.stable)) {
      this.pending = next;
      return this.stable;
    }
    if (!Object.is(next, this.pending)) {
      this.pending = next;
      this.pendingSince = now;
    }
    if (now - this.pendingSince >= this.delayMs) this.stable = next;
    return this.stable;
  }

  force(value: T): void {
    this.stable = value;
    this.pending = value;
  }
}
