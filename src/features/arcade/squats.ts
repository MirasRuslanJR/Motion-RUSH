import type { SfxName } from '../../lib/audio/sfx';
import { clock, type ArcadeGame, type ArcadeHud, type ArcadeInput, type ArcadeResult } from './types';

export const SQUATS = {
  durationMs: 30000,
  /** Every this many squats — a cheer. */
  milestone: 5,
};

/**
 * Squat 30: as many full squats as possible in 30 seconds. A squat counts when
 * the player goes down far enough AND stands up again. The engine diagnoses
 * the expected crouch, so a shallow squat or a bow gets the usual error-mode
 * advice ("Присядь глубже — таз ниже").
 */
export class SquatGame implements ArcadeGame {
  readonly expected = 'CROUCH' as const;
  time = 0;
  count = 0;
  hintsShown = 0;
  done = false;
  private lastHint: string | null = null;
  private toastState: ArcadeHud['toast'] = null;
  private toastId = 0;

  update(input: ArcadeInput, dtMs: number): SfxName[] {
    const sounds: SfxName[] = [];
    if (this.done || !input.pose) return sounds;
    this.time += dtMs;
    for (const e of input.events) {
      if (e.type !== 'CROUCH' || e.phase !== 'end') continue;
      this.count++;
      sounds.push(this.count % SQUATS.milestone === 0 ? 'combo' : 'clear');
      if (this.count % SQUATS.milestone === 0) this.toastState = { id: ++this.toastId, text: `${this.count}! Так держать`, tone: 'good' };
    }
    if (input.hint && input.hint !== this.lastHint) {
      this.hintsShown++;
      this.toastState = { id: ++this.toastId, text: input.hint, tone: 'info' };
    }
    this.lastHint = input.hint;
    if (this.time >= SQUATS.durationMs) {
      this.done = true;
      sounds.push('complete');
    }
    return sounds;
  }

  hud(): ArcadeHud {
    return {
      stat: { label: 'Приседаний', value: String(this.count) },
      counter: clock(SQUATS.durationMs - this.time),
      lives: null,
      progress: Math.min(1, this.time / SQUATS.durationMs),
      combo: 0,
      cue: this.time < 2200 ? { text: 'Приседай!', tone: 'go', sub: 'Вниз — до конца, и снова вверх' } : null,
      toast: this.toastState,
      meter: null,
    };
  }

  result(): ArcadeResult {
    const perMinute = Math.round((this.count / SQUATS.durationMs) * 60000);
    return {
      score: this.count * 100,
      headline: String(this.count),
      caption: 'приседаний за 30 секунд',
      lines: [
        `Темп: ${perMinute} в минуту`,
        this.hintsShown > 0 ? `Подсказок о технике: ${this.hintsShown}` : 'Техника без замечаний',
      ],
      accuracy: 1,
      bestCombo: this.count,
    };
  }
}
