import type { SfxName } from '../../lib/audio/sfx';
import { armAngles, DANCE_POSES, poseMatch, type DancePose } from '../dance/dance';
import { createRng } from '../gameplay/course';
import type { Lane } from '../gameplay/types';
import type { ExpectedMotion } from '../gestures/types';
import { bodyOf, clock, lerpRange, NORMAL_TUNE, type ArcadeGame, type ArcadeHud, type ArcadeInput, type ArcadeResult, type ArcadeTune, type Tone } from './types';

/** Boss fight tuning. Times in ms of game time. */
export const BOSS = {
  hp: 5,
  lives: 3,
  readyMs: 1800,
  /** Warning before an attack lands: at full health → on its last hit point. */
  telegraphMs: [1600, 950] as const,
  /** Rest between attacks: at full health → on its last hit point. */
  gapMs: [1000, 550] as const,
  /** A lane strike is dodged if the player is out of the struck lanes within this long after it lands. */
  laneGraceMs: 180,
  /** A beam is dodged by a crouch in this window around the impact… */
  crouchWindowMs: [-260, 260] as const,
  /** …a wave by a jump that takes off in this one. */
  jumpWindowMs: [-460, 220] as const,
  /** Dodges in a row that stun the boss. */
  streakForStun: 3,
  stunMs: 2800,
  /** How well both arms must be raised (the dance-floor pose match) to land the counter-hit. */
  hitMatch: 0.62,
  /** After a counter-hit the boss recovers this long. */
  recoverMs: 1300,
  /** Arms count for the hit only this long after the stun begins (a jump swings them up by itself). */
  hitDelayMs: 350,
  points: { dodge: 100, counter: 600, win: 2000, life: 400 },
};

export type BossAttackKind = 'lane' | 'sweep' | 'beam' | 'wave';
export type BossPhase = 'ready' | 'fight' | 'stunned' | 'won' | 'lost';

export interface BossAttack {
  id: number;
  kind: BossAttackKind;
  /** The lanes that get hit (lane strike and sweep). */
  lanes: Lane[];
  startAt: number;
  hitAt: number;
  result: 'pending' | 'dodged' | 'hit';
}

/** A short-lived effect for the renderer. */
export interface BossFlash {
  at: number;
  kind: 'dodge' | 'hit' | 'counter' | 'stun';
  points: number;
}

const ARMS_UP = DANCE_POSES.find((p) => p.id === 'V') as DancePose;
const INTRO: readonly BossAttackKind[] = ['lane', 'beam', 'wave', 'sweep'];
const LANE_NAME: Record<Lane, string> = { [-1]: 'левой', 0: 'центральной', 1: 'правой' };

export function laneOf(lateral: ArcadeInput['lateral']): Lane {
  return lateral === 'LEAN_LEFT' ? -1 : lateral === 'LEAN_RIGHT' ? 1 : 0;
}

/**
 * Boss fight: the boss attacks and the player dodges with the whole body — out of
 * a struck lane, into the one free lane of a sweep, down under a beam, up over a wave.
 * Three dodges in a row stun the boss: then both arms up land a hit. Five hits win.
 * The boss aims at the player and gets faster as it loses health. The move the
 * player needs is the engine's expected move, so a wrong dodge gets the usual
 * error-mode advice, and a hit says why it hit.
 */
export class BossFight implements ArcadeGame {
  phase: BossPhase = 'ready';
  time = 0;
  hp = BOSS.hp;
  lives = BOSS.lives;
  score = 0;
  streak = 0;
  bestStreak = 0;
  dodges = 0;
  attacks = 0;
  counters = 0;
  done = false;
  attack: BossAttack | null = null;
  /** The player's lane now, and how well both arms are up (for the counter-hit). */
  playerLane: Lane = 0;
  armMatch = 0;
  stunnedUntil = 0;
  private stunnedAt = 0;
  flashes: BossFlash[] = [];
  private nextAttackAt = BOSS.readyMs;
  private nextId = 1;
  private introIndex = 0;
  private recent: BossAttackKind[] = [];
  private lastJumpAt = Number.NEGATIVE_INFINITY;
  private crouchSeen = false;
  private hint: string | null = null;
  private bodyX = 0.5;
  private readonly tune: ArcadeTune;
  private readonly rng: () => number;
  private toastState: ArcadeHud['toast'] = null;
  private toastId = 0;

  constructor(seed = Math.floor(Math.random() * 0x7fffffff), tune: ArcadeTune = NORMAL_TUNE) {
    this.rng = createRng(seed);
    this.tune = tune;
    this.lives = Math.max(1, BOSS.lives + tune.lives);
  }

  /** 0 at full health → 1 on the last hit point. */
  private get rage(): number {
    return Math.min(1, (BOSS.hp - this.hp) / Math.max(1, BOSS.hp - 1));
  }

  get expected(): ExpectedMotion | null {
    const a = this.attack;
    if (!a || a.result !== 'pending' || this.phase !== 'fight') return null;
    switch (a.kind) {
      case 'beam':
        return 'CROUCH';
      case 'wave':
        return 'JUMP';
      case 'sweep':
      case 'lane': {
        if (!a.lanes.includes(this.playerLane)) return null;
        const safe = ([-1, 0, 1] as Lane[]).filter((l) => !a.lanes.includes(l));
        // Out of the struck lane the nearest way; from the centre, to the side the body already leans to.
        const target = safe.includes(0) ? 0 : safe.length === 1 ? (safe[0] as Lane) : this.bodyX < 0.5 ? -1 : 1;
        return target === -1 ? 'LEAN_LEFT' : target === 1 ? 'LEAN_RIGHT' : 'CENTER';
      }
    }
  }

  update(input: ArcadeInput, dtMs: number): SfxName[] {
    const sounds: SfxName[] = [];
    if (this.done) return sounds;
    const pose = input.pose;
    if (!pose) return sounds; // The fight waits while the player is out of view.
    this.time += dtMs;
    const t = this.time;
    this.playerLane = laneOf(input.lateral);
    const body = bodyOf(pose);
    if (body) this.bodyX = body.center.x / Math.max(1e-3, input.aspect);
    for (const e of input.events) if (e.type === 'JUMP' && e.phase === 'start') this.lastJumpAt = t;
    if (input.hint) this.hint = input.hint;
    const arms = armAngles(pose);
    this.armMatch = arms.visible ? poseMatch(arms, ARMS_UP) : 0;
    this.flashes = this.flashes.filter((f) => t - f.at < 1200);

    if (this.phase === 'ready' && t >= BOSS.readyMs) this.phase = 'fight';

    if (this.phase === 'stunned') {
      if (this.armMatch >= BOSS.hitMatch && t - this.stunnedAt >= BOSS.hitDelayMs) this.counterHit(t, sounds);
      else if (t >= this.stunnedUntil) {
        this.phase = 'fight';
        this.streak = 0;
        this.nextAttackAt = t + lerpRange(BOSS.gapMs, this.rage) / this.tune.pace;
        this.toast('Не успел ударить — босс очнулся. Руки вверх, пока он оглушён', 'info');
      }
      return sounds;
    }

    if (this.phase !== 'fight') return sounds;
    const a = this.attack;
    if (!a && t >= this.nextAttackAt) {
      this.startAttack(t);
      sounds.push('tick');
    } else if (a && a.result === 'pending') {
      this.judge(a, input, t, sounds);
    }
    return sounds;
  }

  private judge(a: BossAttack, input: ArcadeInput, t: number, sounds: SfxName[]): void {
    let dodged = false;
    let over = false;
    switch (a.kind) {
      case 'lane':
      case 'sweep':
        if (t >= a.hitAt) {
          dodged = !a.lanes.includes(this.playerLane);
          over = dodged || t >= a.hitAt + BOSS.laneGraceMs;
        }
        break;
      case 'beam': {
        const [from, to] = BOSS.crouchWindowMs;
        if (t >= a.hitAt + from && input.vertical === 'CROUCH') this.crouchSeen = true;
        if (t >= a.hitAt) {
          dodged = this.crouchSeen;
          over = dodged || t >= a.hitAt + to;
        }
        break;
      }
      case 'wave': {
        const [from, to] = BOSS.jumpWindowMs;
        if (t >= a.hitAt) {
          dodged = this.lastJumpAt >= a.hitAt + from && this.lastJumpAt <= a.hitAt + to;
          over = dodged || t >= a.hitAt + to;
        }
        break;
      }
    }
    if (!over) return;
    a.result = dodged ? 'dodged' : 'hit';
    if (dodged) this.onDodge(t, sounds);
    else this.onHit(a, t, sounds);
    this.attack = null;
    if (this.phase === 'fight') this.nextAttackAt = t + lerpRange(BOSS.gapMs, this.rage) / this.tune.pace;
  }

  private onDodge(t: number, sounds: SfxName[]): void {
    this.dodges++;
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    const points = Math.round(BOSS.points.dodge * this.tune.score) * Math.min(4, 1 + Math.floor(this.streak / 3));
    this.score += points;
    this.flashes.push({ at: t, kind: 'dodge', points });
    sounds.push('clear');
    if (this.streak % BOSS.streakForStun === 0) {
      this.phase = 'stunned';
      this.stunnedAt = t;
      this.stunnedUntil = t + BOSS.stunMs;
      this.flashes.push({ at: t, kind: 'stun', points: 0 });
      this.toast(`${BOSS.streakForStun} уклонения подряд — босс оглушён! Руки вверх — удар!`, 'good');
      sounds.push('combo');
    }
  }

  private onHit(a: BossAttack, t: number, sounds: SfxName[]): void {
    this.lives--;
    this.streak = 0;
    this.flashes.push({ at: t, kind: 'hit', points: 0 });
    sounds.push('miss');
    // Why it hit: the error-mode advice if there was one, else what the attack needed.
    const why =
      this.hint ??
      (a.kind === 'beam'
        ? 'Луч задел — присядь, когда он летит'
        : a.kind === 'wave'
          ? 'Волна сбила — подпрыгни, когда она у ног'
          : `Удар по ${a.lanes.length > 1 ? 'двум полосам' : `${LANE_NAME[a.lanes[0] ?? 0]} полосе`} — уйди с красного`);
    this.toast(why, 'bad');
    if (this.lives <= 0) {
      this.phase = 'lost';
      this.done = true;
      sounds.push('gameover');
    }
  }

  private counterHit(t: number, sounds: SfxName[]): void {
    this.hp--;
    this.counters++;
    this.streak = 0;
    const points = Math.round(BOSS.points.counter * this.tune.score);
    this.score += points;
    this.flashes.push({ at: t, kind: 'counter', points });
    sounds.push('perfect');
    if (this.hp <= 0) {
      this.phase = 'won';
      this.done = true;
      this.score += Math.round((BOSS.points.win + this.lives * BOSS.points.life + Math.max(0, Math.round((150000 - t) / 50))) * this.tune.score);
      this.toast('Босс повержен!', 'good');
      sounds.push('complete');
      return;
    }
    this.phase = 'fight';
    this.nextAttackAt = t + BOSS.recoverMs / this.tune.pace;
    this.toast(`Удар! У босса осталось ${this.hp} из ${BOSS.hp}`, 'good');
  }

  private startAttack(t: number): void {
    const kind = this.pickKind();
    let lanes: Lane[] = [];
    if (kind === 'lane') {
      // Mostly aimed at the player.
      lanes = [this.rng() < 0.7 ? this.playerLane : (([-1, 0, 1] as Lane[])[Math.floor(this.rng() * 3)] ?? 0)];
    } else if (kind === 'sweep') {
      // Two neighbouring lanes, one of them the player's: only the far lane is free.
      lanes = this.playerLane === -1 ? [-1, 0] : this.playerLane === 1 ? [0, 1] : this.rng() < 0.5 ? [-1, 0] : [0, 1];
    }
    const telegraph = lerpRange(BOSS.telegraphMs, this.rage) / this.tune.pace;
    this.attack = { id: this.nextId++, kind, lanes, startAt: t, hitAt: t + telegraph, result: 'pending' };
    this.attacks++;
    this.crouchSeen = false;
    this.hint = null;
  }

  /** Every attack once first, then at random — never three of a kind in a row. */
  private pickKind(): BossAttackKind {
    let kind: BossAttackKind;
    if (this.introIndex < INTRO.length) {
      kind = INTRO[this.introIndex++] ?? 'lane';
    } else {
      const [a, b] = this.recent.slice(-2);
      const options = (['lane', 'lane', 'sweep', 'beam', 'wave'] as const).filter((k) => !(k === a && k === b));
      kind = options[Math.floor(this.rng() * options.length)] ?? 'lane';
    }
    this.recent.push(kind);
    return kind;
  }

  hud(): ArcadeHud {
    let cue: ArcadeHud['cue'] = null;
    const a = this.attack;
    if (this.phase === 'ready') {
      cue = { text: 'Приготовься', tone: 'info', sub: 'Уклоняйся шагом, приседом и прыжком' };
    } else if (this.phase === 'stunned') {
      cue = { text: 'Руки вверх — удар!', tone: 'go', sub: 'Босс оглушён' };
    } else if (a && a.result === 'pending') {
      cue = this.attackCue(a);
    }
    return {
      stat: { label: 'Очки', value: this.score.toLocaleString('ru-RU') },
      counter: clock(this.time),
      lives: this.lives,
      progress: null,
      combo: this.streak,
      cue,
      toast: this.toastState,
      meter: this.phase === 'stunned' ? { value: Math.min(1, this.armMatch), mark: BOSS.hitMatch, label: 'Руки вверх', danger: false } : null,
      boss: { hp: this.hp, max: BOSS.hp, stunned: this.phase === 'stunned' },
    };
  }

  private attackCue(a: BossAttack): NonNullable<ArcadeHud['cue']> {
    switch (a.kind) {
      case 'beam':
        return { text: 'Присядь!', tone: 'stop', sub: 'Луч на уровне головы' };
      case 'wave':
        return { text: 'Прыгай!', tone: 'stop', sub: 'Волна по полу' };
      case 'sweep': {
        const free = ([-1, 0, 1] as Lane[]).find((l) => !a.lanes.includes(l)) ?? 0;
        return { text: free === -1 ? 'Влево!' : free === 1 ? 'Вправо!' : 'В центр!', tone: 'stop', sub: 'Удар по двум полосам' };
      }
      case 'lane': {
        const lane = a.lanes[0] ?? 0;
        if (lane !== this.playerLane) return { text: 'Стой тут!', tone: 'go', sub: `Удар по ${LANE_NAME[lane]} полосе — мимо тебя` };
        return { text: lane === 0 ? 'Шаг в сторону!' : 'В центр!', tone: 'stop', sub: `Удар по ${LANE_NAME[lane]} полосе` };
      }
    }
  }

  result(): ArcadeResult {
    const won = this.phase === 'won';
    return {
      score: this.score,
      headline: won ? clock(this.time) : `${BOSS.hp - this.hp} из ${BOSS.hp}`,
      caption: won ? 'босс повержен' : 'ударов по боссу — жизни кончились',
      lines: [
        `Уклонений: ${this.dodges} из ${this.attacks}`,
        `Контратак: ${this.counters}`,
        `Лучшая серия уклонений: ${this.bestStreak}`,
        `Очки: ${this.score.toLocaleString('ru-RU')}`,
      ],
      accuracy: this.attacks > 0 ? this.dodges / this.attacks : 0,
      bestCombo: this.bestStreak,
    };
  }

  private toast(text: string, tone: Tone): void {
    this.toastState = { id: ++this.toastId, text, tone };
  }
}
