export type SfxName =
  | 'tick'
  | 'go'
  | 'clear'
  | 'perfect'
  | 'combo'
  | 'miss'
  | 'orb'
  | 'jump'
  | 'confirm'
  | 'step'
  | 'complete'
  | 'gameover';

interface Note {
  freq: number;
  /** Start offset, seconds. */
  at: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  /** Glide to this frequency over the note. */
  to?: number;
}

const SOUNDS: Record<SfxName, Note[]> = {
  tick: [{ freq: 660, at: 0, dur: 0.09, type: 'sine', gain: 0.35 }],
  go: [
    { freq: 660, at: 0, dur: 0.12, type: 'triangle', gain: 0.4 },
    { freq: 990, at: 0.08, dur: 0.28, type: 'triangle', gain: 0.45, to: 1320 },
  ],
  clear: [{ freq: 740, at: 0, dur: 0.12, type: 'triangle', gain: 0.35, to: 1100 }],
  perfect: [
    { freq: 880, at: 0, dur: 0.08, type: 'triangle', gain: 0.35 },
    { freq: 1320, at: 0.06, dur: 0.08, type: 'triangle', gain: 0.35 },
    { freq: 1760, at: 0.12, dur: 0.14, type: 'sine', gain: 0.3 },
  ],
  combo: [
    { freq: 523, at: 0, dur: 0.08, type: 'square', gain: 0.12 },
    { freq: 659, at: 0.07, dur: 0.08, type: 'square', gain: 0.12 },
    { freq: 784, at: 0.14, dur: 0.08, type: 'square', gain: 0.12 },
    { freq: 1047, at: 0.21, dur: 0.18, type: 'triangle', gain: 0.3 },
  ],
  miss: [
    { freq: 180, at: 0, dur: 0.26, type: 'sawtooth', gain: 0.18, to: 80 },
    { freq: 120, at: 0.02, dur: 0.22, type: 'square', gain: 0.08, to: 60 },
  ],
  orb: [{ freq: 1400, at: 0, dur: 0.07, type: 'sine', gain: 0.25, to: 1900 }],
  jump: [{ freq: 300, at: 0, dur: 0.14, type: 'sine', gain: 0.2, to: 620 }],
  confirm: [
    { freq: 660, at: 0, dur: 0.1, type: 'triangle', gain: 0.35 },
    { freq: 990, at: 0.09, dur: 0.18, type: 'triangle', gain: 0.35 },
  ],
  step: [{ freq: 520, at: 0, dur: 0.06, type: 'sine', gain: 0.2 }],
  complete: [
    { freq: 523, at: 0, dur: 0.14, type: 'triangle', gain: 0.35 },
    { freq: 659, at: 0.12, dur: 0.14, type: 'triangle', gain: 0.35 },
    { freq: 784, at: 0.24, dur: 0.14, type: 'triangle', gain: 0.35 },
    { freq: 1047, at: 0.36, dur: 0.4, type: 'sine', gain: 0.35 },
  ],
  gameover: [
    { freq: 440, at: 0, dur: 0.2, type: 'triangle', gain: 0.3, to: 330 },
    { freq: 330, at: 0.18, dur: 0.2, type: 'triangle', gain: 0.3, to: 247 },
    { freq: 247, at: 0.36, dur: 0.45, type: 'sine', gain: 0.3, to: 165 },
  ],
};

/**
 * Tiny synthesized sound kit (no audio files to load).
 * The AudioContext is created on the first user gesture (START button)
 * to respect browser autoplay policies.
 */
class SoundKit {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;

  unlock(): void {
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.6;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.6, this.ctx.currentTime, 0.02);
  }

  play(name: SfxName): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.muted || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    for (const note of SOUNDS[name]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + note.at;
      const end = start + note.dur;
      osc.type = note.type ?? 'sine';
      osc.frequency.setValueAtTime(note.freq, start);
      if (note.to) osc.frequency.exponentialRampToValueAtTime(note.to, end);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(note.gain ?? 0.3, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain).connect(master);
      osc.start(start);
      osc.stop(end + 0.02);
    }
  }
}

export const sfx = new SoundKit();
