/**
 * A small synthesizer for the game music — everything is generated with WebAudio,
 * no audio files. A MusicBus is one song's mixer: drums go straight to the output,
 * the melodic parts go through a group that ducks on every kick ("pumping", the
 * classic dance-music sidechain), and there are a reverb and a tempo-synced echo.
 */

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
const roomCache = new WeakMap<BaseAudioContext, AudioBuffer>();

export function midiHz(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buffer = noiseCache.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, buffer);
  }
  return buffer;
}

/** A synthetic room: decaying stereo noise as the reverb's impulse response. */
function roomImpulse(ctx: BaseAudioContext): AudioBuffer {
  let buffer = roomCache.get(ctx);
  if (!buffer) {
    const length = Math.floor(ctx.sampleRate * 2.2);
    buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3.2;
    }
    roomCache.set(ctx, buffer);
  }
  return buffer;
}

export class MusicBus {
  readonly ctx: AudioContext;
  /** Drums: never ducked. */
  readonly dry: GainNode;
  /** Bass, chords and melodies: they dip on every kick and swell back. */
  readonly pumped: GainNode;
  /** Sends. */
  readonly reverb: GainNode;
  readonly echo: GainNode;
  private readonly out: GainNode;
  private readonly nodes: AudioNode[];
  private volume: number;

  constructor(ctx: AudioContext, destination: AudioNode, volume: number, beatS: number) {
    this.ctx = ctx;
    this.volume = volume;
    const out = ctx.createGain();
    out.gain.value = volume;
    out.connect(destination);
    // Glue for the whole mix, and a guard against clipping when everything plays at once.
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -16;
    glue.knee.value = 8;
    glue.ratio.value = 3;
    glue.attack.value = 0.008;
    glue.release.value = 0.18;
    glue.connect(out);
    const dry = ctx.createGain();
    dry.connect(glue);
    const pumped = ctx.createGain();
    pumped.connect(glue);

    const room = ctx.createConvolver();
    room.buffer = roomImpulse(ctx);
    const roomReturn = ctx.createGain();
    roomReturn.gain.value = 0.3;
    room.connect(roomReturn).connect(glue);
    const reverb = ctx.createGain();
    reverb.connect(room);

    // Dotted-eighth echo, darker with every repeat.
    const delay = ctx.createDelay(2);
    delay.delayTime.value = beatS * 0.75;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.34;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2800;
    delay.connect(tone).connect(feedback).connect(delay);
    const echoReturn = ctx.createGain();
    echoReturn.gain.value = 0.45;
    tone.connect(echoReturn).connect(glue);
    const echo = ctx.createGain();
    echo.connect(delay);

    this.out = out;
    this.dry = dry;
    this.pumped = pumped;
    this.reverb = reverb;
    this.echo = echo;
    this.nodes = [out, glue, dry, pumped, room, roomReturn, reverb, delay, feedback, tone, echoReturn, echo];
  }

  /** Sidechain: the melodic group dips at `at` and comes back over `releaseS`. */
  pump(at: number, depth = 0.6, releaseS = 0.26): void {
    const g = this.pumped.gain;
    g.cancelScheduledValues(at);
    g.setValueAtTime(1 - depth, at);
    g.linearRampToValueAtTime(1, at + releaseS);
  }

  /** Fades to `factor` × the song's volume (a pause, a red light). */
  duck(factor: number, timeConstant = 0.15): void {
    this.out.gain.setTargetAtTime(this.volume * factor, this.ctx.currentTime, timeConstant);
  }

  setVolume(volume: number, timeConstant = 0.15): void {
    this.volume = volume;
    this.duck(1, timeConstant);
  }

  /** Fades out and frees every node of the song. */
  dispose(fadeS = 0.08): void {
    this.out.gain.cancelScheduledValues(this.ctx.currentTime);
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, fadeS);
    const nodes = this.nodes;
    window.setTimeout(() => nodes.forEach((n) => n.disconnect()), fadeS * 6000 + 300);
  }
}

/** Connects a voice to its group and to the effect sends. */
function route(bus: MusicBus, voice: AudioNode, group: AudioNode, reverb = 0, echo = 0): void {
  voice.connect(group);
  if (reverb > 0) {
    const send = bus.ctx.createGain();
    send.gain.value = reverb;
    voice.connect(send).connect(bus.reverb);
  }
  if (echo > 0) {
    const send = bus.ctx.createGain();
    send.gain.value = echo;
    voice.connect(send).connect(bus.echo);
  }
}

function envelope(param: AudioParam, at: number, peak: number, attackS: number, durS: number, releaseS: number): void {
  param.setValueAtTime(0.0001, at);
  param.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attackS);
  param.setValueAtTime(Math.max(0.0002, peak), at + Math.max(attackS, durS));
  param.exponentialRampToValueAtTime(0.0001, at + Math.max(attackS, durS) + releaseS);
}

function noiseVoice(bus: MusicBus, at: number, durS: number, level: number, type: BiquadFilterType, freq: number, group: AudioNode, q = 0.8): void {
  const { ctx } = bus;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(level, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + durS);
  src.connect(filter).connect(gain).connect(group);
  src.start(at, Math.random() * 1.5);
  src.stop(at + durS + 0.03);
}

/** Four-on-the-floor kick: a falling sine with a click on top. Pumps the melodic group. */
export function kick(bus: MusicBus, at: number, level = 1, pump = 0.6): void {
  const { ctx } = bus;
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(165, at);
  osc.frequency.exponentialRampToValueAtTime(47, at + 0.12);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(level, at + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.34);
  osc.connect(gain).connect(bus.dry);
  osc.start(at);
  osc.stop(at + 0.36);
  noiseVoice(bus, at, 0.014, level * 0.22, 'highpass', 3000, bus.dry);
  if (pump > 0) bus.pump(at, pump);
}

export function clap(bus: MusicBus, at: number, level = 0.45): void {
  for (const [offset, k] of [
    [0, 1],
    [0.011, 0.75],
    [0.023, 0.9],
  ] as const) {
    noiseVoice(bus, at + offset, 0.03, level * k, 'bandpass', 1350, bus.dry, 1.1);
  }
  noiseVoice(bus, at + 0.03, 0.2, level * 0.65, 'bandpass', 1150, bus.dry, 0.9);
  noiseVoice(bus, at, 0.16, level * 0.5, 'bandpass', 1500, bus.reverb, 1);
}

export function snare(bus: MusicBus, at: number, level = 0.35): void {
  const { ctx } = bus;
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(220, at);
  osc.frequency.exponentialRampToValueAtTime(150, at + 0.08);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(level * 0.7, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
  osc.connect(gain).connect(bus.dry);
  osc.start(at);
  osc.stop(at + 0.14);
  noiseVoice(bus, at, 0.16, level, 'highpass', 1800, bus.dry);
}

export function hat(bus: MusicBus, at: number, level = 0.1, open = false): void {
  noiseVoice(bus, at, open ? 0.26 : 0.045, level, 'highpass', open ? 6500 : 8200, bus.dry);
}

export function crash(bus: MusicBus, at: number, level = 0.22): void {
  noiseVoice(bus, at, 1.8, level, 'highpass', 4600, bus.dry);
  noiseVoice(bus, at, 1.4, level * 0.5, 'highpass', 3800, bus.reverb);
}

/** White-noise sweep up to the drop. */
export function riser(bus: MusicBus, at: number, durS: number, level = 0.16): void {
  const { ctx } = bus;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.4;
  filter.frequency.setValueAtTime(350, at);
  filter.frequency.exponentialRampToValueAtTime(9000, at + durS);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(level, at + durS * 0.95);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + durS + 0.05);
  src.connect(filter).connect(gain);
  route(bus, gain, bus.dry, 0.4);
  src.start(at);
  src.stop(at + durS + 0.1);
}

/** Saw bass with a sub and a short filter "pluck". */
export function bass(bus: MusicBus, note: number, at: number, durS: number, level = 0.32, bright = 1): void {
  const { ctx } = bus;
  const f = midiHz(note);
  const saw = ctx.createOscillator();
  saw.type = 'sawtooth';
  saw.frequency.value = f;
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = f;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 5;
  filter.frequency.setValueAtTime(1600 * bright, at);
  filter.frequency.exponentialRampToValueAtTime(420 * bright, at + 0.14);
  const tone = ctx.createGain();
  tone.gain.value = 0.55;
  const gain = ctx.createGain();
  envelope(gain.gain, at, level, 0.006, durS * 0.8, 0.06);
  saw.connect(filter).connect(tone).connect(gain);
  sub.connect(gain);
  route(bus, gain, bus.pumped);
  saw.start(at);
  sub.start(at);
  saw.stop(at + durS + 0.1);
  sub.stop(at + durS + 0.1);
}

/** Supersaw chord: three detuned saws per note through one filter. */
export function chord(bus: MusicBus, notes: readonly number[], at: number, durS: number, level = 0.06, cutoff = 2400, reverb = 0.35): void {
  const { ctx } = bus;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  filter.Q.value = 0.7;
  const gain = ctx.createGain();
  envelope(gain.gain, at, level, 0.025, durS, 0.18);
  filter.connect(gain);
  route(bus, gain, bus.pumped, reverb);
  for (const note of notes) {
    for (const detune of [-14, 0, 14]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = midiHz(note);
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(at);
      osc.stop(at + durS + 0.25);
    }
  }
}

/** Soft pad: slow attack and release, lots of room. */
export function pad(bus: MusicBus, notes: readonly number[], at: number, durS: number, level = 0.045, cutoff = 1300): void {
  const { ctx } = bus;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.linearRampToValueAtTime(level, at + Math.min(0.6, durS * 0.4));
  gain.gain.setValueAtTime(level, at + durS);
  gain.gain.linearRampToValueAtTime(0.0001, at + durS + 0.7);
  filter.connect(gain);
  route(bus, gain, bus.pumped, 0.6);
  for (const note of notes) {
    for (const [type, detune] of [
      ['triangle', -7],
      ['sawtooth', 7],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = midiHz(note);
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(at);
      osc.stop(at + durS + 0.8);
    }
  }
}

/** Short bright note for arpeggios, with an echo. */
export function pluck(bus: MusicBus, note: number, at: number, level = 0.06, echo = 0.3): void {
  const { ctx } = bus;
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.value = midiHz(note);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(4200, at);
  filter.frequency.exponentialRampToValueAtTime(700, at + 0.16);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(level, at + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.24);
  osc.connect(filter).connect(gain);
  route(bus, gain, bus.pumped, 0.25, echo);
  osc.start(at);
  osc.stop(at + 0.26);
}

/** The hook: two detuned saws with a late vibrato, an echo and some room. */
export function lead(bus: MusicBus, note: number, at: number, durS: number, level = 0.07): void {
  const { ctx } = bus;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 3400;
  filter.Q.value = 1.5;
  const gain = ctx.createGain();
  envelope(gain.gain, at, level, 0.012, durS * 0.85, 0.12);
  filter.connect(gain);
  route(bus, gain, bus.pumped, 0.3, 0.32);
  const vibrato = ctx.createOscillator();
  vibrato.frequency.value = 5.6;
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(0, at);
  depth.gain.linearRampToValueAtTime(9, at + Math.min(0.25, durS));
  vibrato.connect(depth);
  vibrato.start(at);
  vibrato.stop(at + durS + 0.2);
  for (const detune of [-8, 8]) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = midiHz(note);
    osc.detune.value = detune;
    depth.connect(osc.detune);
    osc.connect(filter);
    osc.start(at);
    osc.stop(at + durS + 0.2);
  }
}

/**
 * Steps a song forward on the audio clock: every step (a sixteenth note) that
 * starts before the look-ahead horizon is handed to `play` once, slightly early.
 */
export class StepClock {
  readonly stepS: number;
  private startAt = 0;
  private next = 0;

  constructor(stepS: number) {
    this.stepS = stepS;
  }

  start(at: number): void {
    this.startAt = at;
    this.next = 0;
  }

  get origin(): number {
    return this.startAt;
  }

  run(ctx: AudioContext, lookaheadS: number, play: (step: number, at: number) => void, lastStep = Number.POSITIVE_INFINITY): void {
    const horizon = ctx.currentTime + lookaheadS;
    while (this.next < lastStep) {
      const at = this.startAt + this.next * this.stepS;
      if (at > horizon) break;
      // A step that is already late (the tab was hidden) is skipped, not played in a burst.
      if (at >= ctx.currentTime - 0.03) play(this.next, at);
      this.next++;
    }
  }
}
