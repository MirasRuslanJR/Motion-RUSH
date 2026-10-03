import { bass, chord, clap, crash, hat, kick, lead, MusicBus, pad, pluck, riser, snare, StepClock } from '../../lib/audio/synth';
import { sfx } from '../../lib/audio/sfx';
import { sectionAt, SONG_BEATS, type SongSection } from './choreography';
import { BEAT_MS } from './dance';

const BEAT_S = BEAT_MS / 1000;
const STEP_S = BEAT_S / 4;
const LOOKAHEAD_S = 0.2;
const VOLUME = 0.5;

/** A minor: Am – F – C – G, one bar each; every part of the song starts on Am. */
const CHORDS = [
  [57, 60, 64],
  [57, 60, 65],
  [55, 60, 64],
  [55, 59, 62],
] as const;
const ROOTS = [45, 41, 48, 43] as const;
/** The build-up climbs F → G, so the drop lands on Am. */
const BUILD_CHORDS = [1, 3] as const;

/** The hook, one bar per chord, in eighth notes (null = rest). */
const HOOK: readonly (readonly (number | null)[])[] = [
  [76, null, 76, 74, 72, null, 69, null],
  [72, null, 72, 74, 72, null, 69, 67],
  [67, null, 72, null, 76, null, 74, 72],
  [74, null, null, 71, 74, null, 79, null],
];
/** Arpeggio over the chord: indices into [root, third, fifth, octave]. */
const ARP = [0, 1, 2, 3, 2, 1, 0, 1] as const;

function arpNote(notes: readonly number[], i: number): number {
  const idx = ARP[i % ARP.length] ?? 0;
  return idx === 3 ? (notes[0] ?? 57) + 12 : (notes[idx] ?? 57);
}

/** How long a hook note rings: until the next note of the bar. */
function hookLength(bar: readonly (number | null)[], slot: number): number {
  let rests = 0;
  for (let i = slot + 1; i < bar.length && bar[i] === null; i++) rests++;
  return (1 + rests) * 2 * STEP_S * 0.92;
}

/**
 * The dance-floor track, written for the choreography (choreography.ts): a quiet
 * intro with a 4-3-2-1 count, a house verse, a snare roll and a riser into the
 * drop, a full chorus with a pumping supersaw and a hook, a breather, a second
 * build and a final chorus where the hook goes an octave up, then the last chord.
 * Notes are scheduled on the AudioContext clock and the song time is read from
 * the same clock, so judging and what the dancer hears never drift apart.
 */
export class DanceMusic {
  private ctx: AudioContext | null = null;
  private bus: MusicBus | null = null;
  private readonly clock = new StepClock(STEP_S);
  private fallbackStart = 0;

  /** Starts the song `delayMs` from now. */
  start(delayMs = 0): void {
    const audio = sfx.audio();
    this.fallbackStart = performance.now() + delayMs;
    if (!audio || audio.ctx.state !== 'running') return;
    this.ctx = audio.ctx;
    this.bus = new MusicBus(audio.ctx, audio.master, VOLUME, BEAT_S);
    this.clock.start(audio.ctx.currentTime + delayMs / 1000);
  }

  /** Song time in ms (negative before the first beat). */
  get time(): number {
    if (this.ctx) return (this.ctx.currentTime - this.clock.origin) * 1000;
    return performance.now() - this.fallbackStart;
  }

  /** Call every frame: schedules the next notes. */
  update(): void {
    const ctx = this.ctx;
    const bus = this.bus;
    if (!ctx || !bus) return;
    this.clock.run(ctx, LOOKAHEAD_S, (step, at) => this.playStep(bus, step, at), SONG_BEATS * 4);
  }

  stop(): void {
    this.bus?.dispose();
    this.bus = null;
    this.ctx = null;
  }

  private playStep(bus: MusicBus, step: number, at: number): void {
    const beat = Math.floor(step / 4);
    const section = sectionAt(beat);
    const local = beat - section.from;
    const pos = step % 4;
    const inBar = (step - section.from * 4) % 16;
    const barInSection = Math.floor(local / 4);
    const chordIx = section.kind === 'build' ? (BUILD_CHORDS[barInSection % 2] ?? 1) : barInSection % 4;
    const notes = CHORDS[chordIx] ?? CHORDS[0];
    const root = ROOTS[chordIx] ?? 45;
    switch (section.kind) {
      case 'intro':
        return this.intro(bus, beat, pos, inBar, notes, root, at);
      case 'verse':
        return this.verse(bus, section, beat, local, pos, inBar, step, notes, root, at);
      case 'build':
        return this.build(bus, section, step, local, pos, inBar, notes, root, at);
      case 'drop':
        return this.drop(bus, section, beat, local, pos, inBar, step, chordIx, notes, root, at);
      case 'break':
        return this.breather(bus, pos, inBar, step, notes, root, at);
      case 'outro':
        return this.outro(bus, local, beat, pos, inBar, notes, root, at);
    }
  }

  private intro(bus: MusicBus, beat: number, pos: number, inBar: number, notes: readonly number[], root: number, at: number): void {
    // The pad opens up through the intro.
    if (inBar === 0) pad(bus, notes, at, BEAT_S * 4, 0.05, 500 + (beat / 16) * 2400);
    // 4-3-2-1: four ticks, the last one higher.
    if (beat >= 4 && beat < 8 && pos === 0) pluck(bus, beat === 7 ? 88 : 81, at, 0.08, 0.12);
    if (beat >= 8) {
      if (pos === 0) kick(bus, at, 0.85);
      if (pos === 2) {
        hat(bus, at, 0.08);
        bass(bus, root, at, STEP_S * 1.6, 0.22, 0.8);
      }
    }
    if (beat >= 12 && pos % 2 === 1) hat(bus, at, 0.03);
  }

  private verse(bus: MusicBus, section: SongSection, beat: number, local: number, pos: number, inBar: number, step: number, notes: readonly number[], root: number, at: number): void {
    if (pos === 0) kick(bus, at, 0.95);
    if (pos === 0 && beat % 2 === 1) clap(bus, at, 0.38);
    if (pos === 2) {
      hat(bus, at, 0.09, inBar === 14);
      bass(bus, root + (inBar === 14 ? 12 : 0), at, STEP_S * 1.6, 0.27);
      chord(bus, notes, at, STEP_S * 1.1, 0.032, 1800, 0.25);
    }
    if (pos % 2 === 1) hat(bus, at, 0.032);
    // The second half of a long verse adds an arpeggio.
    const long = section.to - section.from >= 32;
    if (long && local >= 16 && pos % 2 === 0) pluck(bus, arpNote(notes, step / 2) + 12, at, 0.032, 0.22);
  }

  private build(bus: MusicBus, section: SongSection, step: number, local: number, pos: number, inBar: number, notes: readonly number[], root: number, at: number): void {
    const k = local / (section.to - section.from);
    // The drums drop out for the last two beats; the roll and the riser carry on.
    const tail = local >= section.to - section.from - 2;
    if (step === section.from * 4) riser(bus, at, (section.to - section.from) * BEAT_S, 0.15);
    if (inBar === 0) pad(bus, notes, at, BEAT_S * 4, 0.05, 900 + 3200 * k);
    const every = local < 4 ? 2 : 1;
    if (pos % every === 0) snare(bus, at, 0.08 + 0.3 * k);
    if (!tail && pos === 0) kick(bus, at, 0.95);
    if (!tail && pos === 2) bass(bus, root, at, STEP_S * 1.6, 0.26);
  }

  private drop(
    bus: MusicBus,
    section: SongSection,
    beat: number,
    local: number,
    pos: number,
    inBar: number,
    step: number,
    chordIx: number,
    notes: readonly number[],
    root: number,
    at: number,
  ): void {
    const final = section.from > 100;
    if (pos === 0 && local % 16 === 0) crash(bus, at, 0.2);
    if (pos === 0) kick(bus, at, 1, 0.65);
    if (pos === 0 && beat % 2 === 1) clap(bus, at, 0.45);
    if (pos === 2) hat(bus, at, 0.1, true);
    else if (pos !== 0) hat(bus, at, 0.035);
    // Galloping bass between the kicks.
    if (pos !== 0) bass(bus, root + (pos === 2 ? 12 : 0), at, STEP_S * 0.9, 0.23);
    if (inBar === 0) chord(bus, notes, at, BEAT_S * 4 - 0.05, 0.05, 3000, 0.35);
    if (pos % 2 === 0) {
      const bar = HOOK[chordIx] ?? HOOK[0] ?? [];
      const slot = inBar / 2;
      const note = bar[slot];
      // The last two bars of the final chorus: the hook an octave up.
      const up = final && local >= section.to - section.from - 8 ? 12 : 0;
      if (note) lead(bus, note + up, at, hookLength(bar, slot), 0.055);
    }
    if (final && pos % 2 === 1) pluck(bus, arpNote(notes, step) + 24, at, 0.025, 0.2);
  }

  private breather(bus: MusicBus, pos: number, inBar: number, step: number, notes: readonly number[], root: number, at: number): void {
    if (inBar === 0) {
      pad(bus, notes, at, BEAT_S * 4, 0.055, 1500);
      bass(bus, root, at, BEAT_S * 3.5, 0.16, 0.6);
    }
    if (pos === 2) hat(bus, at, 0.045);
    if (pos % 2 === 0) pluck(bus, arpNote(notes, step / 2) + 12, at, 0.045, 0.4);
  }

  private outro(bus: MusicBus, local: number, beat: number, pos: number, inBar: number, notes: readonly number[], root: number, at: number): void {
    if (local < 2) {
      if (pos === 0) kick(bus, at, 1, 0.65);
      if (pos === 0 && beat % 2 === 1) clap(bus, at, 0.45);
      if (pos !== 0) bass(bus, root + (pos === 2 ? 12 : 0), at, STEP_S * 0.9, 0.23);
      if (inBar === 0) chord(bus, notes, at, BEAT_S * 2, 0.05, 3000, 0.35);
      return;
    }
    // The last chord: Am with the hook's top note, ringing out.
    if (local === 2 && pos === 0) {
      kick(bus, at, 1, 0);
      crash(bus, at, 0.24);
      chord(bus, [57, 60, 64, 69], at, BEAT_S * 4, 0.06, 2600, 0.7);
      pad(bus, [45, 57, 64], at, BEAT_S * 4.5, 0.05, 1200);
      lead(bus, 81, at, BEAT_S * 2.5, 0.055);
      bass(bus, 45, at, BEAT_S * 3, 0.25, 0.7);
    }
  }
}
