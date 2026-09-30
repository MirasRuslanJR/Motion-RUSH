import { sfx } from '../../lib/audio/sfx';
import { BEAT_MS, DANCE_CONFIG } from './dance';

/** A–minor pop progression (Am F C G), bass roots in Hz. */
const ROOTS = [110, 87.31, 130.81, 98];
/** Arpeggio (semitones over the root) for the second half. */
const ARP = [12, 15, 19, 24, 19, 15, 12, 7];
const LOOKAHEAD_S = 0.25;

/**
 * Synthesized dance track (no audio files): kick, clap, hats, bass and an
 * arpeggio that joins in the second half. Notes are scheduled a little ahead
 * on the AudioContext clock; the song time is read from that clock too, so
 * judging and what the player hears never drift apart.
 */
export class DanceMusic {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private startAt = 0;
  private scheduled = 0;
  private fallbackStart = 0;
  private noise: AudioBuffer | null = null;

  /** Starts the song `delayMs` from now. */
  start(delayMs = 0): void {
    const audio = sfx.audio();
    this.fallbackStart = performance.now() + delayMs;
    if (!audio || audio.ctx.state !== 'running') return;
    this.ctx = audio.ctx;
    this.out = audio.ctx.createGain();
    this.out.gain.value = 0.55;
    this.out.connect(audio.master);
    this.startAt = audio.ctx.currentTime + delayMs / 1000;
    this.scheduled = 0;
    const buffer = audio.ctx.createBuffer(1, audio.ctx.sampleRate * 0.2, audio.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buffer;
  }

  /** Song time in ms (negative before the first beat). */
  get time(): number {
    if (this.ctx) return (this.ctx.currentTime - this.startAt) * 1000;
    return performance.now() - this.fallbackStart;
  }

  /** Call every frame: schedules the next notes. */
  update(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const beatS = BEAT_MS / 1000;
    const horizon = ctx.currentTime + LOOKAHEAD_S;
    // Scheduling unit: an eighth note.
    while (this.scheduled < DANCE_CONFIG.beats * 2) {
      const at = this.startAt + (this.scheduled * beatS) / 2;
      if (at > horizon) break;
      if (at >= ctx.currentTime - 0.05) this.playStep(this.scheduled, at, beatS);
      this.scheduled++;
    }
  }

  stop(): void {
    const out = this.out;
    if (out && this.ctx) {
      out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      window.setTimeout(() => out.disconnect(), 400);
    }
    this.ctx = null;
    this.out = null;
  }

  private playStep(step: number, at: number, beatS: number): void {
    const beat = Math.floor(step / 2);
    const offbeat = step % 2 === 1;
    const bar = Math.floor(beat / 4);
    const root = ROOTS[bar % ROOTS.length] ?? 110;
    const intro = beat < 8;
    if (!offbeat) this.kick(at);
    if (!offbeat && beat % 2 === 1 && !intro) this.clap(at);
    if (offbeat) this.hat(at);
    if (!intro) this.tone(root * (offbeat ? 2 : 1), at, beatS * 0.45, 'sawtooth', 0.09, 900);
    if (beat >= 40) {
      const note = ARP[step % ARP.length] ?? 12;
      this.tone(root * 2 ** (note / 12) * 2, at, beatS * 0.4, 'square', 0.035, 2400);
    }
  }

  private kick(at: number): void {
    const ctx = this.ctx;
    const out = this.out;
    if (!ctx || !out) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(150, at);
    osc.frequency.exponentialRampToValueAtTime(45, at + 0.14);
    gain.gain.setValueAtTime(0.9, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.22);
    osc.connect(gain).connect(out);
    osc.start(at);
    osc.stop(at + 0.25);
  }

  private noiseHit(at: number, dur: number, gainValue: number, freq: number, type: BiquadFilterType): void {
    const ctx = this.ctx;
    const out = this.out;
    if (!ctx || !out || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + dur);
    src.connect(filter).connect(gain).connect(out);
    src.start(at);
    src.stop(at + dur + 0.02);
  }

  private hat(at: number): void {
    this.noiseHit(at, 0.05, 0.18, 7000, 'highpass');
  }

  private clap(at: number): void {
    this.noiseHit(at, 0.14, 0.35, 1500, 'bandpass');
  }

  private tone(freq: number, at: number, dur: number, type: OscillatorType, gainValue: number, cutoff: number): void {
    const ctx = this.ctx;
    const out = this.out;
    if (!ctx || !out) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(gainValue, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(filter).connect(gain).connect(out);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }
}
