import type { SfxName } from '../../lib/audio/sfx';
import { createRng } from '../gameplay/course';
import { copyPoseInto, createPose, LM, lm, type Pose } from '../tracking/landmarks';
import { bodyOf, clock, lerpRange, type ArcadeGame, type ArcadeHud, type ArcadeInput, type ArcadeResult, type Tone } from './types';

/** Freeze! tuning. Motion is measured in shoulder widths per second (SW/s). */
export const FREEZE = {
  finishM: 100,
  lives: 3,
  /** "Get ready" before the first green. */
  readyMs: 1500,
  greenMs: [2600, 5200] as const,
  redMs: [1700, 3200] as const,
  /** Reaction time after the light turns red: no penalty yet. */
  graceMs: 450,
  /** Motion of full-speed running on the spot… */
  runEnergy: 2.6,
  /** …gives this speed. */
  maxSpeedMps: 6.5,
  /** Moving faster than this during red, for caughtAfterMs, gets the player caught. */
  freezeLimit: 1.1,
  caughtAfterMs: 280,
  /** Caught: this many metres back and a short break. */
  penaltyM: 10,
  breakMs: 1500,
  /** Smoothing of the motion measure. */
  energyTauMs: 180,
};

const GROUPS = {
  arms: [LM.LEFT_ELBOW, LM.RIGHT_ELBOW, LM.LEFT_WRIST, LM.RIGHT_WRIST],
  legs: [LM.LEFT_KNEE, LM.RIGHT_KNEE, LM.LEFT_ANKLE, LM.RIGHT_ANKLE],
  torso: [LM.NOSE, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_HIP, LM.RIGHT_HIP],
} as const;

export type BodyGroup = keyof typeof GROUPS;
export const BODY_GROUP_JOINTS: Readonly<Record<BodyGroup, readonly number[]>> = GROUPS;

const CAUGHT_TEXT: Record<BodyGroup, string> = {
  arms: 'Попался — двигались руки',
  legs: 'Попался — двигались ноги',
  torso: 'Попался — качнулся корпус',
};

export type MotionEnergy = Record<BodyGroup | 'total', number>;

/** How fast the body moved between two poses: mean joint speed (SW/s) per body part and overall. */
export function motionEnergy(prev: Pose, cur: Pose, dtMs: number, sw: number): MotionEnergy {
  const dt = Math.max(dtMs, 1) / 1000;
  const out: MotionEnergy = { arms: 0, legs: 0, torso: 0, total: 0 };
  let sum = 0;
  let count = 0;
  for (const group of Object.keys(GROUPS) as BodyGroup[]) {
    let groupSum = 0;
    let groupCount = 0;
    for (const i of GROUPS[group]) {
      const a = lm(prev, i);
      const b = lm(cur, i);
      if (Math.min(a.v, b.v) < 0.5) continue;
      groupSum += Math.hypot(b.x - a.x, b.y - a.y);
      groupCount++;
    }
    out[group] = groupCount > 0 ? groupSum / groupCount / dt / sw : 0;
    sum += groupSum;
    count += groupCount;
  }
  out.total = count > 0 ? sum / count / dt / sw : 0;
  return out;
}

export type Light = 'ready' | 'green' | 'red';

/**
 * Freeze! — "red light, green light": run on the spot while the light is
 * green to cover 100 m, freeze when it turns red. The camera measures how
 * still the player is and, when it catches them, says which part moved.
 */
export class FreezeGame implements ArcadeGame {
  readonly expected = null;
  light: Light = 'ready';
  time = 0;
  distance = 0;
  lives = FREEZE.lives;
  caught = 0;
  redsSurvived = 0;
  bestStreak = 0;
  done = false;
  finished = false;
  /** Smoothed motion measure, SW/s. */
  energy = 0;
  parts: Record<BodyGroup, number> = { arms: 0, legs: 0, torso: 0 };
  /** The last catch: which part moved (highlighted on the camera). */
  lastCatch: { at: number; group: BodyGroup } | null = null;
  private streak = 0;
  private movingFor = 0;
  private lightEndsAt = FREEZE.readyMs;
  private redStartedAt = 0;
  private breakUntil = 0;
  private caughtThisRed = false;
  private readonly prev = createPose();
  private hasPrev = false;
  private prevAt = 0;
  private readonly rng: () => number;
  private toastState: ArcadeHud['toast'] = null;
  private toastId = 0;

  constructor(seed = Math.floor(Math.random() * 0x7fffffff)) {
    this.rng = createRng(seed);
  }

  update(input: ArcadeInput, dtMs: number): SfxName[] {
    const sounds: SfxName[] = [];
    const pose = input.pose;
    const body = pose ? bodyOf(pose) : null;
    if (this.done || !pose || !body) {
      // Paused while the player is out of view; motion is measured afresh after.
      this.hasPrev = false;
      return sounds;
    }
    this.time += dtMs;
    const t = this.time;

    if (input.inferred || !this.hasPrev) {
      if (this.hasPrev && t > this.prevAt) {
        const e = motionEnergy(this.prev, pose, t - this.prevAt, body.sw);
        const a = 1 - Math.exp(-(t - this.prevAt) / FREEZE.energyTauMs);
        this.energy += (e.total - this.energy) * a;
        for (const g of Object.keys(this.parts) as BodyGroup[]) this.parts[g] += (e[g] - this.parts[g]) * a;
      }
      copyPoseInto(pose, this.prev);
      this.hasPrev = true;
      this.prevAt = t;
    }

    if (t >= this.lightEndsAt) {
      if (this.light === 'red') {
        if (!this.caughtThisRed) {
          this.redsSurvived++;
          this.streak++;
          this.bestStreak = Math.max(this.bestStreak, this.streak);
          this.toast('Молодец — ни шевеления!', 'good');
          sounds.push('clear');
        }
        this.setLight('green', t);
        sounds.push('go');
      } else if (this.light === 'green') {
        this.setLight('red', t);
        sounds.push('tick');
      } else {
        this.setLight('green', t);
        sounds.push('go');
      }
    }

    if (this.light === 'green' && t >= this.breakUntil) {
      const speed = Math.min(1.2, this.energy / FREEZE.runEnergy) * FREEZE.maxSpeedMps;
      this.distance = Math.min(FREEZE.finishM, this.distance + (speed * dtMs) / 1000);
      if (this.distance >= FREEZE.finishM) {
        this.done = true;
        this.finished = true;
        sounds.push('complete');
      }
    } else if (this.light === 'red' && !this.caughtThisRed && t >= this.breakUntil && t - this.redStartedAt >= FREEZE.graceMs) {
      this.movingFor = this.energy > FREEZE.freezeLimit ? this.movingFor + dtMs : Math.max(0, this.movingFor - dtMs * 2);
      if (this.movingFor >= FREEZE.caughtAfterMs) this.catchPlayer(t, sounds);
    }
    return sounds;
  }

  get score(): number {
    const base = Math.round(this.distance * 10);
    return this.finished ? base + 1000 + this.lives * 300 + Math.max(0, Math.round((90000 - this.time) / 100)) : base;
  }

  hud(): ArcadeHud {
    const red = this.light === 'red';
    const cue: ArcadeHud['cue'] =
      this.light === 'ready'
        ? { text: 'Приготовься…', tone: 'info', sub: 'Зелёный — беги на месте, красный — замри' }
        : red
          ? { text: 'ЗАМРИ!', tone: 'stop', sub: 'Ни шевеления' }
          : { text: 'Беги на месте!', tone: 'go', sub: 'Выше колени — быстрее бежишь' };
    return {
      stat: { label: 'Дистанция', value: `${Math.floor(this.distance)} м` },
      counter: clock(this.time),
      lives: this.lives,
      progress: this.distance / FREEZE.finishM,
      combo: this.streak,
      cue,
      toast: this.toastState,
      meter: red
        ? { value: Math.min(1, this.energy / (FREEZE.freezeLimit * 1.5)), mark: 1 / 1.5, label: 'Движение', danger: this.energy > FREEZE.freezeLimit }
        : this.light === 'green'
          ? { value: Math.min(1, this.energy / FREEZE.runEnergy), mark: null, label: 'Скорость', danger: false }
          : null,
    };
  }

  result(): ArcadeResult {
    const rounds = this.redsSurvived + this.caught;
    return {
      score: this.score,
      headline: this.finished ? clock(this.time) : `${Math.floor(this.distance)} м`,
      caption: this.finished ? 'до финиша' : 'пройдено — жизни кончились',
      lines: [
        `Красных пережито: ${this.redsSurvived} из ${rounds}`,
        this.caught > 0 ? `Пойман: ${this.caught} раз` : 'Ни разу не пойман!',
        `Лучшая серия без ошибок: ${this.bestStreak}`,
        `Очки: ${this.score.toLocaleString('ru-RU')}`,
      ],
      accuracy: rounds > 0 ? this.redsSurvived / rounds : 1,
      bestCombo: this.bestStreak,
    };
  }

  private setLight(light: Light, t: number): void {
    this.light = light;
    this.caughtThisRed = false;
    this.movingFor = 0;
    if (light === 'red') {
      this.redStartedAt = t;
      this.lightEndsAt = t + lerpRange(FREEZE.redMs, this.rng());
    } else {
      this.lightEndsAt = t + lerpRange(FREEZE.greenMs, this.rng());
    }
  }

  private catchPlayer(t: number, sounds: SfxName[]): void {
    this.caughtThisRed = true;
    this.caught++;
    this.streak = 0;
    this.lives--;
    this.movingFor = 0;
    this.distance = Math.max(0, this.distance - FREEZE.penaltyM);
    const group = (Object.keys(this.parts) as BodyGroup[]).reduce((a, b) => (this.parts[b] > this.parts[a] ? b : a));
    this.lastCatch = { at: t, group };
    this.toast(CAUGHT_TEXT[group], 'bad');
    sounds.push('miss');
    this.breakUntil = t + FREEZE.breakMs;
    if (this.lives <= 0) {
      this.done = true;
      sounds.push('gameover');
    }
  }

  private toast(text: string, tone: Tone): void {
    this.toastState = { id: ++this.toastId, text, tone };
  }
}
