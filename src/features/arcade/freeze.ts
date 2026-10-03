import type { SfxName } from '../../lib/audio/sfx';
import { armAngles, danceHint, DANCE_POSES, poseMatch, type DancePose } from '../dance/dance';
import { createRng } from '../gameplay/course';
import { copyPoseInto, createPose, LM, lm, type Pose } from '../tracking/landmarks';
import { bodyOf, clock, lerpRange, NORMAL_TUNE, type ArcadeGame, type ArcadeHud, type ArcadeInput, type ArcadeResult, type ArcadeTune, type Tone } from './types';

/** Freeze! tuning. Motion is measured in shoulder widths per second (SW/s). */
export const FREEZE = {
  finishM: 100,
  lives: 3,
  /** "Get ready" before the first green. */
  readyMs: 1500,
  greenMs: [2600, 5200] as const,
  /** "Море волнуется…": the yellow light calls the figure. */
  yellowMs: 1000,
  /** Some yellows go back to green — a trick for the impatient (never the first one). */
  fakeChance: 0.2,
  redMs: [2300, 3400] as const,
  /** After red: time to react for a plain freeze… */
  graceMs: 450,
  /** …and to strike the called figure. */
  figureGraceMs: 1000,
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
  /** Average figure match over the red (0..1, the dance-floor measure) that makes a statue. */
  statueMatch: 0.68,
  /** A statue pushes the runner forward and scores; a streak of statues multiplies the points. */
  statueBonusM: 6,
  statuePoints: 250,
  maxStatueMultiplier: 3,
};

const armPose = (id: string) => DANCE_POSES.find((p) => p.id === id) as DancePose;

export interface FreezeFigure {
  name: string;
  pose: DancePose;
}

/** "Морская фигура, замри!" — the red-light figures: dance-floor arm poses with playground names. */
export const FREEZE_FIGURES: readonly FreezeFigure[] = [
  { name: 'Самолёт', pose: armPose('T') },
  { name: 'Победа', pose: armPose('V') },
  { name: 'Статуя Свободы', pose: armPose('L_UP') },
  { name: 'Статуя Свободы', pose: armPose('R_UP') },
  { name: 'Пингвин', pose: armPose('LOW_V') },
  { name: 'Регулировщик', pose: armPose('L_OUT') },
  { name: 'Регулировщик', pose: armPose('R_OUT') },
  { name: 'Диско', pose: armPose('DISCO_L') },
  { name: 'Диско', pose: armPose('DISCO_R') },
];

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

export type Light = 'ready' | 'green' | 'yellow' | 'red';

/**
 * Freeze! — "Море волнуется, раз…": run on the spot while the light is green to
 * cover 100 m. Yellow calls a figure, red means strike it and freeze. A figure
 * held well is a statue: a jump forward and points, more for a streak of them.
 * The camera measures how still the player is and, when it catches them, says
 * which part moved. Some yellows are a trick and go back to green.
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
  /** Figures held well enough to count, of the figures called. */
  statues = 0;
  figuresCalled = 0;
  bestStatueStreak = 0;
  /** Points from statues. */
  bonus = 0;
  done = false;
  finished = false;
  /** Smoothed motion measure, SW/s. */
  energy = 0;
  parts: Record<BodyGroup, number> = { arms: 0, legs: 0, torso: 0 };
  /** The last catch: which part moved (highlighted on the camera). */
  lastCatch: { at: number; group: BodyGroup } | null = null;
  /** The figure called for this red (null = just freeze) and how well the arms match it now (0..1). */
  figure: FreezeFigure | null = null;
  figureMatch = 0;
  /** The last statue (a golden flash on the picture). */
  lastStatue: { at: number; name: string } | null = null;
  private streak = 0;
  private statueStreak = 0;
  private movingFor = 0;
  private lightEndsAt = FREEZE.readyMs;
  private redStartedAt = 0;
  private breakUntil = 0;
  private caughtThisRed = false;
  private fakeOut = false;
  private redsCalled = 0;
  private lastFigure: FreezeFigure | null = null;
  private matchSum = 0;
  private matchMs = 0;
  private figureHint = '';
  private readonly prev = createPose();
  private hasPrev = false;
  private prevAt = 0;
  private readonly rng: () => number;
  private toastState: ArcadeHud['toast'] = null;
  private toastId = 0;

  private readonly tune: ArcadeTune;

  constructor(seed = Math.floor(Math.random() * 0x7fffffff), tune: ArcadeTune = NORMAL_TUNE) {
    this.rng = createRng(seed);
    this.tune = tune;
    this.lives = Math.max(1, FREEZE.lives + tune.lives);
  }

  /** Harder levels: less time to strike the pose and a stricter stillness limit. */
  private get freezeLimit(): number {
    return FREEZE.freezeLimit / this.tune.pace;
  }

  private get figureGrace(): number {
    return FREEZE.figureGraceMs / this.tune.pace;
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

    if (t >= this.lightEndsAt) this.nextLight(t, sounds);
    if (this.done) return sounds;

    // How well the arms match the called figure — the same measure as on the dance floor.
    if (this.figure && (this.light === 'yellow' || this.light === 'red')) {
      const arms = armAngles(pose);
      this.figureMatch = arms.visible ? poseMatch(arms, this.figure.pose) : 0;
      this.figureHint = danceHint(arms, this.figure.pose);
    } else {
      this.figureMatch = 0;
      this.figureHint = '';
    }

    if ((this.light === 'green' || this.light === 'yellow') && t >= this.breakUntil) {
      const speed = Math.min(1.2, this.energy / FREEZE.runEnergy) * FREEZE.maxSpeedMps;
      this.distance = Math.min(FREEZE.finishM, this.distance + (speed * dtMs) / 1000);
      if (this.distance >= FREEZE.finishM) this.finish(sounds);
    } else if (this.light === 'red' && !this.caughtThisRed && t >= this.breakUntil) {
      const grace = this.figure ? this.figureGrace : FREEZE.graceMs / this.tune.pace;
      if (t - this.redStartedAt >= grace) {
        if (this.figure) {
          this.matchSum += this.figureMatch * dtMs;
          this.matchMs += dtMs;
        }
        this.movingFor = this.energy > this.freezeLimit ? this.movingFor + dtMs : Math.max(0, this.movingFor - dtMs * 2);
        if (this.movingFor >= FREEZE.caughtAfterMs) this.catchPlayer(t, sounds);
      }
    }
    return sounds;
  }

  get score(): number {
    const base = Math.round(this.distance * 10) + this.bonus;
    const raw = this.finished ? base + 1000 + this.lives * 300 + Math.max(0, Math.round((90000 - this.time) / 100)) : base;
    return Math.round(raw * this.tune.score);
  }

  hud(): ArcadeHud {
    const f = this.figure;
    let cue: ArcadeHud['cue'];
    switch (this.light) {
      case 'ready':
        cue = { text: 'Приготовься…', tone: 'info', sub: 'Зелёный — беги, жёлтый — смотри фигуру, красный — замри в ней' };
        break;
      case 'green':
        cue = { text: 'Беги на месте!', tone: 'go', sub: 'Выше колени — быстрее бежишь' };
        break;
      case 'yellow':
        cue = { text: 'Море волнуется…', tone: 'warn', sub: f ? `Морская фигура: ${f.name}` : 'Сейчас — замри!' };
        break;
      case 'red': {
        // While the figure is being struck, the dance-floor hint says which arm to fix.
        const striking = f !== null && this.time - this.redStartedAt < this.figureGrace;
        const sub = striking
          ? this.figureHint.startsWith('Точно')
            ? 'Точно! Теперь не шевелись'
            : this.figureHint
          : f
            ? `«${f.name}» — ни шевеления`
            : 'Ни шевеления';
        cue = { text: 'ЗАМРИ!', tone: 'stop', sub };
        break;
      }
    }
    const red = this.light === 'red';
    return {
      stat: { label: 'Дистанция', value: `${Math.floor(this.distance)} м` },
      counter: clock(this.time),
      lives: this.lives,
      progress: this.distance / FREEZE.finishM,
      combo: this.streak,
      cue,
      toast: this.toastState,
      meter: red
        ? { value: Math.min(1, this.energy / (this.freezeLimit * 1.5)), mark: 1 / 1.5, label: 'Движение', danger: this.energy > this.freezeLimit }
        : this.light === 'green' || this.light === 'yellow'
          ? { value: Math.min(1, this.energy / FREEZE.runEnergy), mark: null, label: 'Скорость', danger: false }
          : null,
      figure:
        f && (this.light === 'yellow' || red)
          ? { name: f.name, left: f.pose.left, right: f.pose.right, state: this.light === 'yellow' ? 'soon' : this.figureMatch >= FREEZE.statueMatch ? 'hit' : 'now' }
          : null,
      runner: true,
    };
  }

  result(): ArcadeResult {
    const rounds = this.redsSurvived + this.caught;
    const lines = [
      `Красных пережито: ${this.redsSurvived} из ${rounds}`,
      this.caught > 0 ? `Пойман: ${this.caught} раз` : 'Ни разу не пойман!',
      `Лучшая серия без ошибок: ${this.bestStreak}`,
      `Очки: ${this.score.toLocaleString('ru-RU')}`,
    ];
    if (this.figuresCalled > 0) lines.unshift(`Фигур замерло точно: ${this.statues} из ${this.figuresCalled}`);
    return {
      score: this.score,
      headline: this.finished ? clock(this.time) : `${Math.floor(this.distance)} м`,
      caption: this.finished ? 'до финиша' : 'пройдено — жизни кончились',
      lines,
      accuracy: rounds > 0 ? this.redsSurvived / rounds : 1,
      bestCombo: Math.max(this.bestStreak, this.bestStatueStreak),
    };
  }

  private nextLight(t: number, sounds: SfxName[]): void {
    switch (this.light) {
      case 'ready':
        this.setLight('green', t);
        sounds.push('go');
        break;
      case 'green':
        this.setLight('yellow', t);
        sounds.push('tick');
        break;
      case 'yellow':
        if (this.fakeOut) {
          this.toast('Обманка! Беги дальше', 'info');
          this.setLight('green', t);
          sounds.push('go');
        } else {
          this.setLight('red', t);
          sounds.push('tick');
        }
        break;
      case 'red':
        if (!this.caughtThisRed) this.survived(t, sounds);
        if (!this.done) {
          this.setLight('green', t);
          sounds.push('go');
        }
        break;
    }
  }

  private survived(t: number, sounds: SfxName[]): void {
    this.redsSurvived++;
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    const f = this.figure;
    if (!f) {
      this.toast('Молодец — ни шевеления!', 'good');
      sounds.push('clear');
      return;
    }
    const held = this.matchMs > 0 ? this.matchSum / this.matchMs : 0;
    if (held < FREEZE.statueMatch) {
      this.statueStreak = 0;
      this.toast(`Замер, но фигура не та. Нужно: «${f.name}»`, 'info');
      sounds.push('clear');
      return;
    }
    this.statues++;
    this.statueStreak++;
    this.bestStatueStreak = Math.max(this.bestStatueStreak, this.statueStreak);
    const multiplier = Math.min(FREEZE.maxStatueMultiplier, this.statueStreak);
    const points = FREEZE.statuePoints * multiplier;
    this.bonus += points;
    this.distance = Math.min(FREEZE.finishM, this.distance + FREEZE.statueBonusM);
    this.lastStatue = { at: t, name: f.name };
    this.toast(`Есть фигура «${f.name}»! +${FREEZE.statueBonusM} м, +${points}${multiplier > 1 ? ` ×${multiplier}` : ''}`, 'good');
    sounds.push('perfect');
    if (this.distance >= FREEZE.finishM) this.finish(sounds);
  }

  private finish(sounds: SfxName[]): void {
    this.done = true;
    this.finished = true;
    sounds.push('complete');
  }

  private setLight(light: Light, t: number): void {
    this.light = light;
    this.caughtThisRed = false;
    this.movingFor = 0;
    switch (light) {
      case 'yellow':
        this.lightEndsAt = t + FREEZE.yellowMs / this.tune.pace;
        // The first red is a plain freeze; later ones call a figure, and some yellows are a trick.
        this.figure = this.redsCalled === 0 ? null : this.pickFigure();
        this.fakeOut = this.redsCalled > 0 && this.rng() < Math.min(0.4, FREEZE.fakeChance * this.tune.pace);
        break;
      case 'red':
        this.redStartedAt = t;
        this.redsCalled++;
        if (this.figure) this.figuresCalled++;
        this.matchSum = 0;
        this.matchMs = 0;
        this.lightEndsAt = t + lerpRange(FREEZE.redMs, this.rng());
        break;
      default:
        this.figure = null;
        this.lightEndsAt = t + lerpRange(FREEZE.greenMs, this.rng());
    }
  }

  private pickFigure(): FreezeFigure {
    const options = FREEZE_FIGURES.filter((f) => f.pose !== this.lastFigure?.pose);
    const figure = options[Math.floor(this.rng() * options.length)] ?? (FREEZE_FIGURES[0] as FreezeFigure);
    this.lastFigure = figure;
    return figure;
  }

  private catchPlayer(t: number, sounds: SfxName[]): void {
    this.caughtThisRed = true;
    this.caught++;
    this.streak = 0;
    this.statueStreak = 0;
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
