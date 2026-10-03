import { GAME_CONFIG } from '../../config/game.config';
import type { Verdict } from '../gestures/diagnosisRules';
import { isErrorVerdict } from '../gestures/ErrorDiagnosisEngine';
import { motionMeta, type ControlScheme, type ExpectedMotion } from '../gestures/types';
import type { Difficulty } from '../modes/difficulty';
import { courseDuration, generateCourse } from './course';
import {
  isPickup,
  OBSTACLE_REQUIREMENT,
  type ClearQuality,
  type CourseItem,
  type GameOutcome,
  type Lane,
  type MissReason,
  type ObstacleRecord,
  type PowerUpKind,
  type SessionResult,
} from './types';

export type GamePhase = 'countdown' | 'running' | 'paused' | 'resuming' | 'ended';

export interface DiagnosisInput {
  expected: ExpectedMotion;
  verdict: Verdict;
  ruleId: string;
  message: string;
}

/** Everything the game needs from the motion engine for one frame. */
export interface PlayerInput {
  trackable: boolean;
  lane: Lane;
  jumpHeld: boolean;
  crouchHeld: boolean;
  /** Per-frame diagnosis for the current expectation. */
  diagnosis: DiagnosisInput | null;
  /** Throttled hint that is actually on screen. */
  hint: DiagnosisInput | null;
}

export type GameEvent =
  | { type: 'countdown'; value: number }
  | { type: 'clear'; item: CourseItem; quality: ClearQuality; points: number; combo: number; multiplier: number }
  | { type: 'miss'; item: CourseItem; reason: MissReason }
  | { type: 'orb'; item: CourseItem; points: number }
  /** A power-up was picked up; a heart with full energy is worth `points` instead of a life. */
  | { type: 'powerup'; item: CourseItem; kind: PowerUpKind; points?: number }
  | { type: 'shield-used'; item: CourseItem }
  | { type: 'combo'; combo: number; multiplier: number }
  | { type: 'jump' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'end'; outcome: GameOutcome };

/** Per-mode rules (see features/modes). */
export interface GameRules {
  mode: string;
  scheme: ControlScheme;
  energy: number;
  /** Practice: misses never cost energy. */
  practice: boolean;
  /**
   * Wider timing windows (two players: recognition with two trackers is slower,
   * so a move registers later). Defaults come from GAME_CONFIG.
   */
  timing?: { airtimeMs?: number; clearGraceMs?: number; duckGraceMs?: number };
  /** Every point is worth this much (harder difficulty = more points). */
  scoreScale?: number;
  /** The difficulty the run is played at (shown on the results). */
  difficulty?: Difficulty;
}

const DEFAULT_RULES: GameRules = { mode: 'classic', scheme: 'seated', energy: GAME_CONFIG.energy, practice: false };

interface ActiveObstacle {
  item: CourseItem;
  required: ExpectedMotion;
  /** Start of the current uninterrupted correct pose. */
  satisfiedSince: number | null;
  /** First time the pose was correct at all (to detect "too early"). */
  firstSatisfiedAt: number | null;
  hadErrorHint: boolean;
  lastErrorHint: MissReason | null;
  lastRawError: MissReason | null;
}

function tooEarly(required: ExpectedMotion, scheme: ControlScheme): string {
  switch (required) {
    case 'JUMP':
      return scheme === 'body'
        ? 'Прыжок был слишком рано — прыгай, когда барьер уже у ног'
        : 'Прыжок был слишком рано — поднимай руки, когда барьер уже рядом';
    case 'CROUCH':
      return 'Встал слишком рано — держи присед, пока луч не пролетит';
    case 'LEAN_LEFT':
    case 'LEAN_RIGHT':
      return scheme === 'body'
        ? 'Вернулся раньше времени — стой в полосе, пока ворота не пройдены'
        : 'Вернулся раньше времени — держи наклон, пока ворота не пройдены';
    case 'CENTER':
      return 'Ушёл из центра раньше времени — стой ровно, пока ворота не пройдены';
  }
}

type GameConfig = typeof GAME_CONFIG;

/**
 * Deterministic game logic. No DOM, no randomness at runtime:
 * the same course + the same inputs always produce the same result.
 */
export class GameEngine {
  readonly course: CourseItem[];
  readonly duration: number;
  private readonly cfg: GameConfig;

  phase: GamePhase = 'countdown';
  time = 0;
  score = 0;
  combo = 0;
  bestCombo = 0;
  energy: number;
  lane: Lane = 0;
  airborne = false;
  ducking = false;
  jumpStartedAt = Number.NEGATIVE_INFINITY;

  private pending: CourseItem[];
  private orbs: CourseItem[];
  private active: ActiveObstacle | null = null;
  private readonly records: ObstacleRecord[] = [];
  private countdownElapsed = 0;
  private countdownShown: number | null = null;
  private lostFor = 0;
  private stableFor = 0;
  private resumeElapsed = 0;
  private prevJumpHeld = false;
  private prevCrouchHeld = false;
  private lastCrouchEndAt = Number.NEGATIVE_INFINITY;
  private gesturesDetected = 0;
  private hintsShown = 0;
  private lastHintKey: string | null = null;
  private orbsCollected = 0;
  private readonly timeline: { t: number; score: number }[] = [{ t: 0, score: 0 }];
  private outcome: GameOutcome | null = null;
  readonly rules: GameRules;
  /** A collected shield absorbs the next miss. */
  shield = false;
  /** Double points until this game time. */
  boostUntil = Number.NEGATIVE_INFINITY;
  /** Every energy orb flies to the runner until this game time. */
  magnetUntil = Number.NEGATIVE_INFINITY;
  /** Slow motion until this game time. */
  slowUntil = Number.NEGATIVE_INFINITY;
  /** How long one jump keeps the runner in the air. */
  readonly airtimeMs: number;
  private readonly clearGraceMs: number;
  private readonly duckGraceMs: number;

  constructor(course: CourseItem[] = generateCourse(), cfg: GameConfig = GAME_CONFIG, rules: Partial<GameRules> = {}) {
    this.cfg = cfg;
    this.rules = { ...DEFAULT_RULES, ...rules };
    const timing = this.rules.timing ?? {};
    this.airtimeMs = timing.airtimeMs ?? cfg.airtimeMs;
    this.clearGraceMs = timing.clearGraceMs ?? cfg.clearGraceMs;
    this.duckGraceMs = timing.duckGraceMs ?? cfg.duckGraceMs;
    this.course = course;
    this.duration = courseDuration(course, cfg.course);
    this.energy = this.rules.energy;
    this.pending = course.filter((c) => !isPickup(c.kind));
    this.orbs = course.filter((c) => isPickup(c.kind));
  }

  get boosted(): boolean {
    return this.time < this.boostUntil;
  }

  get magnetized(): boolean {
    return this.time < this.magnetUntil;
  }

  get slowed(): boolean {
    return this.time < this.slowUntil;
  }

  /** Game time per real millisecond: below 1 in slow motion, so obstacles come slower. */
  get timeScale(): number {
    return this.slowed ? this.cfg.powerUps.slowScale : 1;
  }

  get multiplier(): number {
    const s = this.cfg.scoring;
    const combo = Math.min(s.maxMultiplier, 1 + Math.floor(this.combo / s.comboPerMultiplier));
    return combo * (this.boosted ? this.cfg.powerUps.boostMultiplier : 1);
  }

  /** Points for a base value: difficulty scale, then the combo/boost multiplier. */
  private points(base: number): number {
    return Math.round(base * (this.rules.scoreScale ?? 1)) * this.multiplier;
  }

  /** Motion the player must perform right now (drives error mode), if any. */
  get expected(): ExpectedMotion | null {
    return this.phase === 'running' || this.phase === 'paused' || this.phase === 'resuming'
      ? (this.active?.required ?? null)
      : null;
  }

  get activeItem(): CourseItem | null {
    return this.active?.item ?? null;
  }

  /** Next required obstacle (active or upcoming) — for the HUD cue. */
  get nextRequired(): CourseItem | null {
    return this.active?.item ?? this.pending[0] ?? null;
  }

  get countdownValue(): number | null {
    return this.countdownShown;
  }

  get resumeProgress(): number {
    return this.phase === 'resuming' ? this.resumeElapsed / this.cfg.resumeCountdownMs : 0;
  }

  update(dtMs: number, input: PlayerInput): GameEvent[] {
    const events: GameEvent[] = [];
    switch (this.phase) {
      case 'countdown':
        this.updateCountdown(dtMs, input, events);
        break;
      case 'running':
        if (!input.trackable) {
          this.lostFor += dtMs;
          if (this.lostFor >= this.cfg.lostGraceMs) {
            this.phase = 'paused';
            this.stableFor = 0;
            events.push({ type: 'pause' });
            break;
          }
        } else {
          this.lostFor = 0;
        }
        this.step(dtMs, input, events);
        break;
      case 'paused':
        this.stableFor = input.trackable ? this.stableFor + dtMs : 0;
        if (this.stableFor >= this.cfg.resumeStableMs) {
          this.phase = 'resuming';
          this.resumeElapsed = 0;
          events.push({ type: 'resume' });
        }
        break;
      case 'resuming':
        if (!input.trackable) {
          this.phase = 'paused';
          this.stableFor = 0;
          events.push({ type: 'pause' });
          break;
        }
        this.resumeElapsed += dtMs;
        if (this.resumeElapsed >= this.cfg.resumeCountdownMs) {
          this.phase = 'running';
          this.lostFor = 0;
        }
        break;
      case 'ended':
        break;
    }
    return events;
  }

  /** External pause (e.g. tab hidden). */
  pause(): void {
    if (this.phase === 'running' || this.phase === 'resuming') {
      this.phase = 'paused';
      this.stableFor = 0;
    }
  }

  private updateCountdown(dtMs: number, input: PlayerInput, events: GameEvent[]): void {
    if (!input.trackable) {
      this.countdownElapsed = 0;
      this.countdownShown = null;
      return;
    }
    this.countdownElapsed += dtMs;
    const step = this.cfg.countdownStepMs;
    const value = Math.max(0, 3 - Math.floor(this.countdownElapsed / step));
    if (value !== this.countdownShown) {
      this.countdownShown = value;
      events.push({ type: 'countdown', value });
    }
    if (value === 0) {
      this.phase = 'running';
      this.prevJumpHeld = input.jumpHeld;
      this.prevCrouchHeld = input.crouchHeld;
      this.lane = input.lane;
    }
  }

  private satisfied(required: ExpectedMotion): boolean {
    switch (required) {
      case 'LEAN_LEFT':
        return this.lane === -1;
      case 'LEAN_RIGHT':
        return this.lane === 1;
      case 'CENTER':
        return this.lane === 0;
      case 'JUMP':
        return this.airborne;
      case 'CROUCH':
        return this.ducking;
    }
  }

  private step(dtMs: number, input: PlayerInput, events: GameEvent[]): void {
    this.time += dtMs * this.timeScale;
    const t = this.time;

    // Player state (edges count as detected gestures).
    // A jump is one take-off with a fixed flight time: holding the pose (arms up, staying
    // on tiptoe) does NOT keep the runner in the air, and a new jump needs a landing first.
    const landed = t - this.jumpStartedAt > this.airtimeMs;
    if (input.jumpHeld && !this.prevJumpHeld && landed) {
      this.jumpStartedAt = t;
      this.gesturesDetected++;
      events.push({ type: 'jump' });
    }
    if (input.crouchHeld && !this.prevCrouchHeld) this.gesturesDetected++;
    if (!input.crouchHeld && this.prevCrouchHeld) this.lastCrouchEndAt = t;
    if (input.lane !== this.lane && input.lane !== 0) this.gesturesDetected++;
    this.prevJumpHeld = input.jumpHeld;
    this.prevCrouchHeld = input.crouchHeld;
    this.lane = input.lane;
    this.airborne = t - this.jumpStartedAt <= this.airtimeMs;
    this.ducking = input.crouchHeld || t - this.lastCrouchEndAt <= this.duckGraceMs;

    this.updateOrbs(t, events);
    this.updateObstacles(t, input, events);

    const second = Math.floor(t / 1000);
    const last = this.timeline[this.timeline.length - 1];
    if (last && second > last.t) this.timeline.push({ t: second, score: this.score });

    if (this.energy <= 0) this.end('out-of-energy', events);
    else if (this.pending.length === 0 && t >= this.duration) this.end('complete', events);
  }

  private updateOrbs(t: number, events: GameEvent[]): void {
    const w = this.cfg.orbWindowMs;
    while (this.orbs.length > 0) {
      const orb = this.orbs[0];
      if (!orb || t < orb.arriveAt - w) break;
      // A magnet collects every energy orb, whatever the lane; power-ups still need the lane.
      if (this.lane === orb.lane || (orb.kind === 'ORB' && this.magnetized)) {
        const pu = this.cfg.powerUps;
        switch (orb.kind) {
          case 'SHIELD':
            this.shield = true;
            events.push({ type: 'powerup', item: orb, kind: 'SHIELD' });
            break;
          case 'BOOST':
            this.boostUntil = t + pu.boostMs;
            events.push({ type: 'powerup', item: orb, kind: 'BOOST' });
            break;
          case 'MAGNET':
            this.magnetUntil = t + pu.magnetMs;
            events.push({ type: 'powerup', item: orb, kind: 'MAGNET' });
            break;
          case 'SLOWMO':
            this.slowUntil = t + pu.slowMs;
            events.push({ type: 'powerup', item: orb, kind: 'SLOWMO' });
            break;
          case 'HEART':
            if (this.energy < this.rules.energy) {
              this.energy++;
              events.push({ type: 'powerup', item: orb, kind: 'HEART' });
            } else {
              const points = this.points(pu.heartPoints);
              this.score += points;
              events.push({ type: 'powerup', item: orb, kind: 'HEART', points });
            }
            break;
          default: {
            const points = this.points(this.cfg.scoring.orb);
            this.score += points;
            events.push({ type: 'orb', item: orb, points });
          }
        }
        this.orbsCollected++;
        this.orbs.shift();
      } else if (t > orb.arriveAt + w) {
        this.orbs.shift();
      } else {
        break;
      }
    }
  }

  private updateObstacles(t: number, input: PlayerInput, events: GameEvent[]): void {
    const next = this.pending[0];
    if (!this.active && next && t >= next.arriveAt - this.cfg.promptWindowMs) {
      if (isPickup(next.kind)) return;
      this.active = {
        item: next,
        required: OBSTACLE_REQUIREMENT[next.kind],
        satisfiedSince: null,
        firstSatisfiedAt: null,
        hadErrorHint: false,
        lastErrorHint: null,
        lastRawError: null,
      };
    }
    const a = this.active;
    if (!a) return;

    // Error-mode bookkeeping: which hints the player saw for THIS obstacle.
    const hint = input.hint;
    if (hint && hint.expected === a.required && isErrorVerdict(hint.verdict)) {
      a.hadErrorHint = true;
      a.lastErrorHint = { ruleId: hint.ruleId, message: hint.message };
      const key = `${a.item.id}|${hint.ruleId}|${hint.message}`;
      if (key !== this.lastHintKey) {
        this.lastHintKey = key;
        this.hintsShown++;
      }
    }
    const raw = input.diagnosis;
    if (raw && raw.expected === a.required && isErrorVerdict(raw.verdict)) {
      a.lastRawError = { ruleId: raw.ruleId, message: raw.message };
    }

    const ok = this.satisfied(a.required);
    if (ok) {
      a.satisfiedSince ??= t;
      a.firstSatisfiedAt ??= t;
    } else {
      a.satisfiedSince = null;
    }

    if (t < a.item.arriveAt) return;
    if (ok) {
      const perfect = (a.satisfiedSince ?? t) <= a.item.arriveAt - this.cfg.perfectLeadMs;
      this.resolveClear(a, perfect ? 'perfect' : 'good', events);
    } else if (t > a.item.arriveAt + this.clearGraceMs) {
      this.resolveMiss(a, events);
    }
  }

  private record(a: ActiveObstacle, result: ClearQuality | 'miss', missReason: MissReason | null): void {
    this.records.push({
      id: a.item.id,
      kind: a.item.kind,
      arriveAt: a.item.arriveAt,
      required: a.required,
      result,
      leadMs: result === 'miss' || a.satisfiedSince === null ? null : Math.max(0, a.item.arriveAt - a.satisfiedSince),
      hadErrorHint: a.hadErrorHint,
      corrected: a.hadErrorHint && result !== 'miss',
      missReason,
    });
    this.pending.shift();
    this.active = null;
  }

  private resolveClear(a: ActiveObstacle, quality: ClearQuality, events: GameEvent[]): void {
    const s = this.cfg.scoring;
    const multiplier = this.multiplier;
    const points = this.points(quality === 'perfect' ? s.perfect : s.clear);
    this.score += points;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.record(a, quality, null);
    events.push({ type: 'clear', item: a.item, quality, points, combo: this.combo, multiplier });
    if (this.combo % s.comboPerMultiplier === 0) {
      events.push({ type: 'combo', combo: this.combo, multiplier: this.multiplier });
    }
  }

  private resolveMiss(a: ActiveObstacle, events: GameEvent[]): void {
    const scheme = this.rules.scheme;
    const reason: MissReason =
      a.firstSatisfiedAt !== null
        ? { ruleId: 'TOO_EARLY', message: tooEarly(a.required, scheme) }
        : (a.lastErrorHint ??
          a.lastRawError ?? {
            ruleId: 'NO_ATTEMPT',
            message: `Движения не было — ${motionMeta(a.required, scheme).cue.toLowerCase()}`,
          });
    this.combo = 0;
    if (this.shield) {
      // The shield takes the hit: no energy lost (the miss still counts in stats).
      this.shield = false;
      events.push({ type: 'shield-used', item: a.item });
    } else if (!this.rules.practice) {
      this.energy = Math.max(0, this.energy - 1);
    }
    this.record(a, 'miss', reason);
    events.push({ type: 'miss', item: a.item, reason });
  }

  private end(outcome: GameOutcome, events: GameEvent[]): void {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.outcome = outcome;
    this.active = null;
    this.timeline.push({ t: Math.ceil(this.time / 1000), score: this.score });
    events.push({ type: 'end', outcome });
  }

  result(): SessionResult {
    return {
      mode: this.rules.mode,
      scheme: this.rules.scheme,
      outcome: this.outcome ?? 'complete',
      score: this.score,
      bestCombo: this.bestCombo,
      durationMs: this.time,
      obstacles: [...this.records],
      gesturesDetected: this.gesturesDetected,
      hintsShown: this.hintsShown,
      orbsCollected: this.orbsCollected,
      orbsTotal: this.course.filter((c) => isPickup(c.kind)).length,
      timeline: [...this.timeline],
      difficulty: this.rules.difficulty,
      lives: this.rules.energy,
    };
  }
}
