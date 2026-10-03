import type { SfxName } from '../../lib/audio/sfx';
import { createRng } from '../gameplay/course';
import type { GestureType } from '../gestures/types';
import { lerpRange, type ArcadeGame, type ArcadeHud, type ArcadeInput, type ArcadeResult, type Tone } from './types';

export const REACTION = {
  rounds: 10,
  /** Stand still this long before a round starts. */
  readyStillMs: 500,
  /** Random wait before the signal. */
  waitMs: [1300, 3300] as const,
  /** No move this long after the signal = missed round. */
  timeoutMs: 2500,
  /** The time stays on screen this long. */
  shownMs: 1000,
  /** Each false start or wrong move adds this to the average. */
  penaltyMs: 60,
};

const MOVES: readonly GestureType[] = ['LEAN_LEFT', 'LEAN_RIGHT', 'JUMP', 'CROUCH'];

export type ReactionPhase = 'ready' | 'wait' | 'cue' | 'shown';

/** How a reaction time feels. */
export function rateReaction(ms: number): string {
  if (ms < 420) return 'Молния!';
  if (ms < 560) return 'Отлично';
  if (ms < 750) return 'Хорошо';
  return 'Можно быстрее';
}

/**
 * Reaction: stand still, wait for the signal, then make the shown move as fast
 * as possible. The time is measured from the signal to the camera frame in
 * which the move was recognised — so recognition delay does not count against
 * the player. Moving before the signal is a false start.
 */
export class ReactionGame implements ArcadeGame {
  readonly expected = null;
  phase: ReactionPhase = 'ready';
  round = 0;
  cue: GestureType | null = null;
  /** Per round: the move and the time (null = missed). */
  times: { move: GestureType; ms: number | null }[] = [];
  falseStarts = 0;
  wrong = 0;
  done = false;
  private phaseAt = 0;
  private waitFor = 0;
  private stillSince: number | null = null;
  private lastMs: number | null = null;
  private readonly rng: () => number;
  private readonly titleOf: (move: GestureType) => string;
  private toastState: ArcadeHud['toast'] = null;
  private toastId = 0;

  constructor(titleOf: (move: GestureType) => string, seed = Math.floor(Math.random() * 0x7fffffff)) {
    this.titleOf = titleOf;
    this.rng = createRng(seed);
  }

  update(input: ArcadeInput, _dtMs: number, now: number): SfxName[] {
    const sounds: SfxName[] = [];
    if (this.done) return sounds;
    const starts = input.events.filter((e) => e.phase === 'start');
    switch (this.phase) {
      case 'ready': {
        const still = input.pose !== null && input.lateral === null && input.vertical === null;
        this.stillSince = still ? (this.stillSince ?? now) : null;
        if (this.stillSince !== null && now - this.stillSince >= REACTION.readyStillMs) {
          this.phase = 'wait';
          this.phaseAt = now;
          this.waitFor = lerpRange(REACTION.waitMs, this.rng());
        }
        break;
      }
      case 'wait':
        if (starts.length > 0) {
          this.falseStarts++;
          this.toast('Рано! Дождись сигнала', 'bad');
          sounds.push('miss');
          this.phase = 'ready';
          this.stillSince = null;
        } else if (now - this.phaseAt >= this.waitFor) {
          const options = MOVES.filter((m) => m !== this.cue);
          this.cue = options[Math.floor(this.rng() * options.length)] ?? 'JUMP';
          this.phase = 'cue';
          this.phaseAt = now;
          sounds.push('go');
        }
        break;
      case 'cue': {
        const cue = this.cue ?? 'JUMP';
        for (const e of starts) {
          // Started before the signal: the body was already moving.
          if (e.timestamp < this.phaseAt) continue;
          if (e.type === cue) {
            const ms = Math.round(e.timestamp - this.phaseAt);
            this.times.push({ move: cue, ms });
            this.lastMs = ms;
            this.phase = 'shown';
            this.phaseAt = now;
            sounds.push(ms < 560 ? 'perfect' : 'clear');
            return sounds;
          }
          this.wrong++;
          this.toast(`Не то движение — нужно: ${this.titleOf(cue)}`, 'bad');
          sounds.push('miss');
        }
        if (now - this.phaseAt >= REACTION.timeoutMs) {
          this.times.push({ move: cue, ms: null });
          this.lastMs = null;
          this.phase = 'shown';
          this.phaseAt = now;
          sounds.push('miss');
        }
        break;
      }
      case 'shown':
        if (now - this.phaseAt >= REACTION.shownMs) {
          this.round++;
          if (this.round >= REACTION.rounds) {
            this.done = true;
            sounds.push('complete');
          } else {
            this.phase = 'ready';
            this.stillSince = null;
          }
        }
        break;
    }
    return sounds;
  }

  /** Average over the rounds played (a missed round counts as the timeout) plus penalties. */
  get averageMs(): number | null {
    if (this.times.length === 0) return null;
    const sum = this.times.reduce((s, r) => s + (r.ms ?? REACTION.timeoutMs), 0);
    return Math.round(sum / this.times.length + (this.falseStarts + this.wrong) * REACTION.penaltyMs);
  }

  get best(): number | null {
    const ok = this.times.map((r) => r.ms).filter((ms): ms is number => ms !== null);
    return ok.length > 0 ? Math.min(...ok) : null;
  }

  hud(): ArcadeHud {
    const avg = this.averageMs;
    let cue: ArcadeHud['cue'];
    switch (this.phase) {
      case 'ready':
        cue = { text: 'Встань ровно', tone: 'info', sub: `Раунд ${this.round + 1} из ${REACTION.rounds}` };
        break;
      case 'wait':
        cue = { text: 'Жди сигнала…', tone: 'info', sub: 'Не двигайся' };
        break;
      case 'cue':
        cue = { text: this.titleOf(this.cue ?? 'JUMP'), tone: 'go', sub: 'Быстрее!' };
        break;
      default:
        cue = this.lastMs !== null ? { text: `${this.lastMs} мс`, tone: 'good', sub: rateReaction(this.lastMs) } : { text: 'Не успел', tone: 'bad' };
    }
    return {
      stat: { label: 'Средняя реакция', value: avg !== null ? `${avg} мс` : '—' },
      counter: `${Math.min(this.round + 1, REACTION.rounds)} / ${REACTION.rounds}`,
      lives: null,
      progress: this.round / REACTION.rounds,
      combo: 0,
      cue,
      toast: this.toastState,
      meter: null,
    };
  }

  result(): ArcadeResult {
    const avg = this.averageMs ?? REACTION.timeoutMs;
    const hit = this.times.filter((r) => r.ms !== null).length;
    const perMove = MOVES.map((m) => {
      const ms = this.times.filter((r) => r.move === m && r.ms !== null).map((r) => r.ms ?? 0);
      return ms.length > 0 ? `${this.titleOf(m)} — ${Math.round(ms.reduce((a, b) => a + b, 0) / ms.length)} мс` : null;
    }).filter((s): s is string => s !== null);
    return {
      score: Math.max(0, 3000 - avg),
      headline: `${avg} мс`,
      caption: `средняя реакция · ${rateReaction(avg).toLowerCase()}`,
      lines: [
        `Лучшая: ${this.best ?? '—'} мс · успел ${hit} из ${this.times.length}`,
        `Фальстарты: ${this.falseStarts} · не то движение: ${this.wrong}`,
        ...perMove,
      ],
      accuracy: this.times.length > 0 ? hit / this.times.length : 0,
      bestCombo: 0,
    };
  }

  private toast(text: string, tone: Tone): void {
    this.toastState = { id: ++this.toastId, text, tone };
  }
}
