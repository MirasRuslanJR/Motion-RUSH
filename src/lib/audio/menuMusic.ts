import { sfx } from './sfx';
import { bass, clap, hat, kick, lead, MusicBus, pad, pluck, StepClock } from './synth';

const BPM = 96;
const BEAT_S = 60 / BPM;
const STEP_S = BEAT_S / 4;
const LOOKAHEAD_S = 0.3;
const TICK_MS = 60;
const VOLUME = 0.3;

/** D minor: Dm – B♭ – F – C. */
const CHORDS = [
  [50, 53, 57],
  [50, 53, 58],
  [48, 53, 57],
  [48, 52, 55],
] as const;
const ROOTS = [50, 46, 41, 48] as const;
/** A slow melody for the second half of every eight bars: [step in bar, note, length in steps]. */
const MELODY: readonly (readonly (readonly [number, number, number])[])[] = [
  [
    [0, 69, 6],
    [8, 72, 6],
  ],
  [[0, 70, 12]],
  [
    [0, 69, 6],
    [8, 65, 6],
  ],
  [
    [0, 67, 6],
    [8, 64, 7],
  ],
];
const ARP = [0, 1, 2, 3, 2, 1, 2, 3] as const;

/**
 * Main-menu music: a calm synthwave loop — pads, an echoing arpeggio, a half-time
 * beat and a slow melody every other phrase. Unlike the game tracks it schedules
 * itself (the menu has no game loop) and fades in, since it starts on the
 * player's first click or key press.
 */
export class MenuMusic {
  private ctx: AudioContext | null = null;
  private bus: MusicBus | null = null;
  private readonly clock = new StepClock(STEP_S);
  private timer = 0;

  get playing(): boolean {
    return this.ctx !== null;
  }

  start(): void {
    if (this.ctx) return;
    const audio = sfx.audio();
    if (!audio || audio.ctx.state !== 'running') return;
    const ctx = audio.ctx;
    const bus = new MusicBus(ctx, audio.master, 0.0001, BEAT_S);
    bus.setVolume(VOLUME, 0.7);
    this.ctx = ctx;
    this.bus = bus;
    this.clock.start(ctx.currentTime + 0.1);
    const tick = () => this.clock.run(ctx, LOOKAHEAD_S, (step, at) => this.playStep(bus, step, at));
    tick();
    this.timer = window.setInterval(tick, TICK_MS);
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.bus?.dispose(0.25);
    this.bus = null;
    this.ctx = null;
  }

  private playStep(bus: MusicBus, step: number, at: number): void {
    const pos = step % 4;
    const inBar = step % 16;
    const bar = Math.floor(step / 16);
    const chordIx = bar % 4;
    const notes = CHORDS[chordIx] ?? CHORDS[0];
    const root = ROOTS[chordIx] ?? 50;
    // The beat comes in after the first phrase.
    const beat = bar >= 4;

    if (inBar === 0) pad(bus, notes, at, BEAT_S * 4, 0.05, 1400);
    if (pos % 2 === 0) {
      const idx = ARP[(step >> 1) % ARP.length] ?? 0;
      const note = idx === 3 ? (notes[0] ?? 50) + 12 : (notes[idx] ?? 50);
      pluck(bus, note + 12, at, 0.032, 0.42);
    }
    if (inBar === 0 || inBar === 8) bass(bus, root, at, BEAT_S * 1.5, 0.2, 0.7);
    if (inBar === 6 || inBar === 14) bass(bus, root, at, BEAT_S * 0.4, 0.14, 0.7);
    if (beat) {
      if (inBar === 0 || inBar === 10) kick(bus, at, 0.7, 0.35);
      if (inBar === 8) clap(bus, at, 0.26);
      if (pos === 2) hat(bus, at, 0.04);
    }
    if (bar % 8 >= 4) {
      for (const [s, note, len] of MELODY[chordIx] ?? []) {
        if (s === inBar) lead(bus, note, at, len * STEP_S, 0.04);
      }
    }
  }
}
