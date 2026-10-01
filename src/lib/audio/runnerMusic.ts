import { sfx } from './sfx';

const BPM = 128;
const STEP_S = 60 / BPM / 4; // a sixteenth note
const LOOKAHEAD_S = 0.2;
const VOLUME = 0.3;
/** Am – F – C – G, one bar each: bass roots in Hz. */
const ROOTS = [110, 87.31, 130.81, 98];
/** Chord tones (semitones over the root) for the pad and the arpeggio. */
const CHORD = [0, 3, 7, 12];
const MAJOR_CHORD = [0, 4, 7, 12];

/**
 * Background track for the runner modes, synthesised with WebAudio (no files):
 * kick, hats, an off-beat bass, and — as the game speeds up — clap, pad and an
 * arpeggio join in. Plays through the shared sound-kit output, so the mute
 * button silences it too. Notes are scheduled slightly ahead on the audio clock.
 */
export class RunnerMusic {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private startAt = 0;
  private step = 0;
  private intensity = 0;

  get playing(): boolean {
    return this.ctx !== null;
  }

  start(): void {
    if (this.ctx) return;
    const audio = sfx.audio();
    if (!audio || audio.ctx.state !== 'running') return;
    this.ctx = audio.ctx;
    this.out = audio.ctx.createGain();
    this.out.gain.value = VOLUME;
    this.out.connect(audio.master);
    this.startAt = audio.ctx.currentTime + 0.05;
    this.step = 0;
    const buffer = audio.ctx.createBuffer(1, Math.floor(audio.ctx.sampleRate * 0.2), audio.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buffer;
  }

  /** 0 = calm … 3 = full: layers join as the game gets faster. Call every frame. */
  update(intensity: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.intensity = intensity;
    const horizon = ctx.currentTime + LOOKAHEAD_S;
    for (;;) {
      const at = this.startAt + this.step * STEP_S;
      if (at > horizon) break;
      if (at >= ctx.currentTime - 0.02) this.playStep(this.step, at);
      this.step++;
    }
  }

  /** Quieter while the game is paused. */
  duck(on: boolean): void {
    if (this.ctx && this.out) this.out.gain.setTargetAtTime(on ? VOLUME * 0.25 : VOLUME, this.ctx.currentTime, 0.15);
  }

  stop(): void {
    const out = this.out;
    if (out && this.ctx) {
      out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      window.setTimeout(() => out.disconnect(), 600);
    }
    this.ctx = null;
    this.out = null;
  }

  private playStep(step: number, at: number): void {
    const inBar = step % 16;
    const bar = Math.floor(step / 16);
    const chord = bar % ROOTS.length;
    const root = ROOTS[chord] ?? 110;
    const tones = chord === 0 ? CHORD : MAJOR_CHORD;
    const level = this.intensity;
    if (inBar % 4 === 0) this.kick(at);
    if (inBar % 4 === 2) this.noiseHit(at, 0.04, 0.12, 8000, 'highpass');
    if (level >= 1 && (inBar === 4 || inBar === 12)) this.noiseHit(at, 0.12, 0.22, 1600, 'bandpass');
    if (inBar % 4 === 2) this.tone(root, at, STEP_S * 1.6, 'sawtooth', 0.11, 700);
    if (level >= 1 && inBar === 0) {
      for (const t of tones.slice(0, 3)) this.tone(root * 2 * 2 ** (t / 12), at, STEP_S * 15, 'triangle', 0.025, 1800);
    }
    if (level >= 2 && inBar % 2 === 0) {
      const t = tones[(inBar / 2) % tones.length] ?? 0;
      this.tone(root * 4 * 2 ** (t / 12), at, STEP_S * 0.9, 'square', 0.018, 3000);
    }
  }

  private kick(at: number): void {
    const ctx = this.ctx;
    const out = this.out;
    if (!ctx || !out) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(140, at);
    osc.frequency.exponentialRampToValueAtTime(45, at + 0.12);
    gain.gain.setValueAtTime(0.75, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.2);
    osc.connect(gain).connect(out);
    osc.start(at);
    osc.stop(at + 0.22);
  }

  private noiseHit(at: number, dur: number, level: number, freq: number, type: BiquadFilterType): void {
    const ctx = this.ctx;
    const out = this.out;
    if (!ctx || !out || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + dur);
    src.connect(filter).connect(gain).connect(out);
    src.start(at);
    src.stop(at + dur + 0.02);
  }

  private tone(freq: number, at: number, dur: number, type: OscillatorType, level: number, cutoff: number): void {
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
    gain.gain.exponentialRampToValueAtTime(level, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(filter).connect(gain).connect(out);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }
}
