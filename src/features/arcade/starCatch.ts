import type { SfxName } from '../../lib/audio/sfx';
import { clamp, type Point } from '../../lib/math/geometry';
import { createRng } from '../gameplay/course';
import { LM, lm, type Pose } from '../tracking/landmarks';
import { bodyOf, clock, lerpRange, type ArcadeGame, type ArcadeHud, type ArcadeInput, type ArcadeResult, type Tone } from './types';

/** Star Catch tuning. Distances are in shoulder widths (SW) of the player. */
export const STARS = {
  durationMs: 60000,
  lives: 3,
  firstSpawnMs: 900,
  /** Values at the start → at the end of the round. */
  spawnEveryMs: [1150, 620] as const,
  ttlMs: [2700, 1750] as const,
  maxStars: [3, 5] as const,
  bombChance: [0.1, 0.24] as const,
  /** Star size and the reach a hand adds. */
  radiusSW: 0.42,
  handSW: 0.3,
  /** Stars appear this far from the shoulder centre… */
  reachSW: [1.05, 2.05] as const,
  /** …within ±this many degrees from straight up — always within arm's reach. */
  spreadDeg: 118,
  /** Caught in the first share of its life = quick bonus. */
  quickShare: 0.4,
  points: { star: 100, quick: 50 },
  comboPerMultiplier: 5,
  maxMultiplier: 4,
  /** A hand passed this close (× hit radius) and the star still went out = "almost". */
  nearMiss: 1.7,
  /** No new spawns in the last moment of the round. */
  quietEndMs: 800,
};

export interface Star {
  id: number;
  x: number;
  y: number;
  /** Radius, frame units. */
  r: number;
  /** Touch distance: the star plus a hand. */
  hitR: number;
  bornAt: number;
  ttl: number;
  bomb: boolean;
  /** Closest any hand came, frame units. */
  closest: number;
}

/** A star that has just gone: drawn as a short effect. */
export interface Pop {
  id: number;
  x: number;
  y: number;
  r: number;
  at: number;
  kind: 'caught' | 'quick' | 'bomb' | 'missed';
  points: number;
}

/** A hand: between the wrist and the index finger, or the wrist alone. */
export function handPoint(pose: Pose, side: 'left' | 'right'): Point | null {
  const w = lm(pose, side === 'left' ? LM.LEFT_WRIST : LM.RIGHT_WRIST);
  const f = lm(pose, side === 'left' ? LM.LEFT_INDEX : LM.RIGHT_INDEX);
  if (w.v >= 0.4 && f.v >= 0.4) return { x: (w.x + f.x) / 2, y: (w.y + f.y) / 2 };
  return w.v >= 0.4 ? { x: w.x, y: w.y } : null;
}

/** Distance from p to the segment a–b. */
export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Star Catch: stars light up around the player — touch them with a hand
 * before they go out; red bombs must not be touched. Speed and series give
 * more points. A star a hand almost reached gets an error-mode style hint.
 */
export class StarCatch implements ArcadeGame {
  readonly expected = null;
  time = 0;
  score = 0;
  combo = 0;
  bestCombo = 0;
  caught = 0;
  quick = 0;
  missed = 0;
  bombsHit = 0;
  lives = STARS.lives;
  done = false;
  stars: Star[] = [];
  pops: Pop[] = [];
  /** Current hand points (for drawing). */
  hands: [Point | null, Point | null] = [null, null];
  /** Shoulder width the stars were sized with (frame units). */
  sw = 0;
  private prevHands: [Point | null, Point | null] = [null, null];
  private nextSpawnAt = STARS.firstSpawnMs;
  private nextId = 1;
  private readonly rng: () => number;
  private toastState: ArcadeHud['toast'] = null;
  private toastId = 0;

  constructor(seed = Math.floor(Math.random() * 0x7fffffff)) {
    this.rng = createRng(seed);
  }

  get multiplier(): number {
    return Math.min(STARS.maxMultiplier, 1 + Math.floor(this.combo / STARS.comboPerMultiplier));
  }

  update(input: ArcadeInput, dtMs: number): SfxName[] {
    const sounds: SfxName[] = [];
    const pose = input.pose;
    const body = pose ? bodyOf(pose) : null;
    if (this.done || !pose || !body) {
      // The round waits while the player is out of view.
      this.hands = [null, null];
      this.prevHands = [null, null];
      return sounds;
    }
    this.time += dtMs;
    this.sw = body.sw;
    const t = this.time;
    const k = t / STARS.durationMs;
    const hands: [Point | null, Point | null] = [handPoint(pose, 'left'), handPoint(pose, 'right')];

    // Touches: along each hand's path since the last frame, so a fast swipe still counts.
    for (const star of [...this.stars]) {
      for (let h = 0; h < 2; h++) {
        const cur = hands[h];
        if (!cur || !this.stars.includes(star)) continue;
        const d = distToSegment(star, this.prevHands[h] ?? cur, cur);
        star.closest = Math.min(star.closest, d);
        if (d <= star.hitR) this.touch(star, sounds);
      }
    }

    for (const star of [...this.stars]) {
      if (t - star.bornAt < star.ttl) continue;
      this.stars = this.stars.filter((s) => s !== star);
      // A bomb that went out was avoided — nothing to do.
      if (star.bomb) continue;
      this.missed++;
      this.combo = 0;
      this.pops.push({ id: star.id, x: star.x, y: star.y, r: star.r, at: t, kind: 'missed', points: 0 });
      if (star.closest <= star.hitR * STARS.nearMiss) this.toast('Почти! Дотянись до конца — рука прямая', 'info');
    }

    const room = this.stars.length < Math.round(lerpRange(STARS.maxStars, k));
    if (t >= this.nextSpawnAt && room && t < STARS.durationMs - STARS.quietEndMs) {
      this.spawn(body, hands, input.aspect, k);
      this.nextSpawnAt = t + lerpRange(STARS.spawnEveryMs, k);
    }

    this.pops = this.pops.filter((p) => t - p.at < 900);
    this.prevHands = hands;
    this.hands = hands;
    if (this.lives <= 0 || t >= STARS.durationMs) {
      this.done = true;
      sounds.push(this.lives > 0 ? 'complete' : 'gameover');
    }
    return sounds;
  }

  hud(): ArcadeHud {
    return {
      stat: { label: 'Очки', value: this.score.toLocaleString('ru-RU') },
      counter: clock(STARS.durationMs - this.time),
      lives: this.lives,
      progress: Math.min(1, this.time / STARS.durationMs),
      combo: this.combo,
      cue: this.time < 2600 ? { text: 'Лови звёзды руками!', tone: 'go', sub: 'Красные бомбы не трогай' } : null,
      toast: this.toastState,
      meter: null,
    };
  }

  result(): ArcadeResult {
    const total = this.caught + this.missed;
    const accuracy = total > 0 ? this.caught / total : 0;
    return {
      score: this.score,
      headline: this.score.toLocaleString('ru-RU'),
      caption: this.lives > 0 ? 'очков · время вышло' : 'очков · бомбы кончили раунд',
      lines: [
        `Поймано звёзд: ${this.caught} из ${total} (${Math.round(accuracy * 100)}%)`,
        `Быстрых ловлей: ${this.quick}`,
        `Лучшая серия: ${this.bestCombo}`,
        this.bombsHit > 0 ? `Задето бомб: ${this.bombsHit}` : 'Ни одной бомбы — отлично!',
      ],
      accuracy,
      bestCombo: this.bestCombo,
    };
  }

  private touch(star: Star, sounds: SfxName[]): void {
    this.stars = this.stars.filter((s) => s !== star);
    if (star.bomb) {
      this.lives--;
      this.bombsHit++;
      this.combo = 0;
      this.pops.push({ id: star.id, x: star.x, y: star.y, r: star.r, at: this.time, kind: 'bomb', points: 0 });
      this.toast('Бомба! Красные не трогай', 'bad');
      sounds.push('miss');
      return;
    }
    const quick = this.time - star.bornAt <= star.ttl * STARS.quickShare;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.caught++;
    if (quick) this.quick++;
    const points = (STARS.points.star + (quick ? STARS.points.quick : 0)) * this.multiplier;
    this.score += points;
    this.pops.push({ id: star.id, x: star.x, y: star.y, r: star.r, at: this.time, kind: quick ? 'quick' : 'caught', points });
    sounds.push(quick ? 'perfect' : 'orb');
    if (this.combo % STARS.comboPerMultiplier === 0) sounds.push('combo');
  }

  /** A new star within arm's reach, away from the other stars and from where the hands are now. */
  private spawn(body: { center: Point; sw: number }, hands: readonly (Point | null)[], aspect: number, k: number): void {
    const r = STARS.radiusSW * body.sw;
    const hitR = (STARS.radiusSW + STARS.handSW) * body.sw;
    let spot: Point | null = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const angle = ((this.rng() * 2 - 1) * STARS.spreadDeg * Math.PI) / 180;
      const dist = lerpRange(STARS.reachSW, this.rng()) * body.sw;
      const x = clamp(body.center.x + Math.sin(angle) * dist, r + 0.02, aspect - r - 0.02);
      const y = clamp(body.center.y - Math.cos(angle) * dist, r + 0.02, 1 - r - 0.02);
      spot = { x, y };
      const clearOfStars = this.stars.every((s) => Math.hypot(s.x - x, s.y - y) > (s.r + r) * 1.4);
      const clearOfHands = hands.every((h) => !h || Math.hypot(h.x - x, h.y - y) > hitR * 1.6);
      if (clearOfStars && clearOfHands) break;
    }
    if (!spot) return;
    const bomb = this.rng() < lerpRange(STARS.bombChance, k);
    this.stars.push({ id: this.nextId++, x: spot.x, y: spot.y, r, hitR, bornAt: this.time, ttl: lerpRange(STARS.ttlMs, k), bomb, closest: Infinity });
  }

  private toast(text: string, tone: Tone): void {
    this.toastState = { id: ++this.toastId, text, tone };
  }
}
