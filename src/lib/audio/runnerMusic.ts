import { sfx } from './sfx';
import { bass, chord, clap, crash, hat, kick, lead, MusicBus, pad, pluck, StepClock } from './synth';

const BPM = 128;
const BEAT_S = 60 / BPM;
const STEP_S = BEAT_S / 4;
const LOOKAHEAD_S = 0.2;
const VOLUME = 0.36;

/** E minor: Em – C – G – D, one bar each. */
const CHORDS = [
  [52, 55, 59],
  [52, 55, 60],
  [50, 55, 59],
  [50, 54, 57],
] as const;
const ROOTS = [40, 48, 43, 50] as const;
/** The hook (eighth notes, null = rest), one bar per chord. */
const HOOK: readonly (readonly (number | null)[])[] = [
  [71, null, 71, 74, 76, null, 74, 71],
  [72, null, 72, 71, 67, null, 64, null],
  [71, null, 71, 74, 79, null, 78, 76],
  [78, null, 76, null, 74, null, 73, null],
];
const ARP = [0, 1, 2, 1, 0, 1, 2, 3] as const;

/**
 * Background track for the runner modes and mini-games, synthesised with WebAudio
 * (no files): four-on-the-floor drums and an off-beat bass from the start; as the
 * game speeds up, claps and chord stabs, a pumping supersaw with an arpeggio, and
 * finally a hook and a rolling bass join in. Plays through the shared sound-kit
 * output, so the mute button silences it too.
 */
export class RunnerMusic {
  private ctx: AudioContext | null = null;
  private bus: MusicBus | null = null;
  private readonly clock = new StepClock(STEP_S);
  private intensity = 0;

  get playing(): boolean {
    return this.ctx !== null;
  }

  start(): void {
    if (this.ctx) return;
    const audio = sfx.audio();
    if (!audio || audio.ctx.state !== 'running') return;
    this.ctx = audio.ctx;
    this.bus = new MusicBus(audio.ctx, audio.master, VOLUME, BEAT_S);
    this.clock.start(audio.ctx.currentTime + 0.05);
  }

  /** 0 = calm … 3 = full: layers join as the game gets faster. Call every frame. */
  update(intensity: number): void {
    const ctx = this.ctx;
    const bus = this.bus;
    if (!ctx || !bus) return;
    this.intensity = intensity;
    this.clock.run(ctx, LOOKAHEAD_S, (step, at) => this.playStep(bus, step, at));
  }

  /** Quieter while the game is paused (or on a red light). */
  duck(on: boolean): void {
    this.bus?.duck(on ? 0.25 : 1);
  }

  stop(): void {
    this.bus?.dispose();
    this.bus = null;
    this.ctx = null;
  }

  private playStep(bus: MusicBus, step: number, at: number): void {
    const pos = step % 4;
    const inBar = step % 16;
    const bar = Math.floor(step / 16);
    const chordIx = bar % 4;
    const notes = CHORDS[chordIx] ?? CHORDS[0];
    const root = ROOTS[chordIx] ?? 40;
    const level = this.intensity;

    if (pos === 0) kick(bus, at, 0.95, level >= 2 ? 0.62 : 0.45);
    if (pos === 2) hat(bus, at, 0.085, level >= 1);
    if (level >= 1 && pos % 2 === 1) hat(bus, at, 0.03);
    if (level >= 1 && pos === 0 && (inBar === 4 || inBar === 12)) clap(bus, at, 0.38);
    if (level >= 3 && pos === 0 && inBar === 0 && bar % 8 === 0) crash(bus, at, 0.16);

    // Bass: off-beat eighths; a gallop between the kicks at full speed.
    if (level >= 3) {
      if (pos !== 0) bass(bus, root + (pos === 2 ? 12 : 0), at, STEP_S * 0.9, 0.22);
    } else if (pos === 2) {
      bass(bus, root, at, STEP_S * 1.6, 0.26);
    }

    if (inBar === 0) {
      if (level >= 2) chord(bus, notes, at, BEAT_S * 4 - 0.05, 0.042, 2800, 0.3);
      else pad(bus, notes, at, BEAT_S * 4, 0.04, level >= 1 ? 1600 : 900);
    }
    if (level === 1 && pos === 2) chord(bus, notes, at, STEP_S, 0.026, 1700, 0.2);
    if (level >= 2 && pos % 2 === 1) {
      const idx = ARP[(step >> 1) % ARP.length] ?? 0;
      pluck(bus, (idx === 3 ? (notes[0] ?? 52) + 12 : (notes[idx] ?? 52)) + 24, at, 0.024, 0.2);
    }
    if (level >= 3 && pos % 2 === 0) {
      const hook = HOOK[chordIx] ?? HOOK[0] ?? [];
      const slot = inBar / 2;
      const note = hook[slot];
      if (note) {
        let rests = 0;
        for (let i = slot + 1; i < hook.length && hook[i] === null; i++) rests++;
        lead(bus, note, at, (1 + rests) * 2 * STEP_S * 0.9, 0.045);
      }
    }
  }
}
