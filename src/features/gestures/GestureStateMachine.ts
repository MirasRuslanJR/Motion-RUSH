import { GESTURE_CONFIG } from '../../config/gesture.config';
import type { Classification } from './GestureClassifier';
import { GESTURE_PRIORITY, type GestureChannel, type GestureEvent, type GestureEventFeatures, type GestureType } from './types';

export type GesturePhase = 'NEUTRAL' | 'CANDIDATE' | 'CONFIRMED' | 'COOLDOWN';

export interface ChannelState {
  phase: GesturePhase;
  gesture: GestureType | null;
  /** Time the current phase started (ms). */
  since: number;
  /** Consecutive frames spent in CANDIDATE. */
  frames: number;
}

type StateMachineConfig = typeof GESTURE_CONFIG.stateMachine;

const EMPTY_FEATURES: GestureEventFeatures = { leanX: 0, crouchDepth: 0, leftHandLift: 0, rightHandLift: 0 };

/**
 * Explicit per-channel gesture state machine:
 *
 *   NEUTRAL ──active──▶ CANDIDATE ──stable N frames & T ms──▶ CONFIRMED
 *      ▲                    │ lost                               │ metric < release (hysteresis)
 *      └────────────────────┘◀──────── COOLDOWN ◀───────────────┘
 *
 * - stable-frame requirement rejects single-frame noise
 * - release < activation (hysteresis) prevents flicker at the threshold
 * - cooldown blocks the SAME gesture from re-firing (no LEFT LEFT LEFT spam)
 * - a higher-priority gesture may take over a confirmed one deterministically
 */
export class GestureStateMachine {
  readonly channel: GestureChannel;
  private readonly cfg: StateMachineConfig;
  private state: ChannelState = { phase: 'NEUTRAL', gesture: null, since: 0, frames: 0 };
  private cooldown: { gesture: GestureType; until: number } | null = null;

  constructor(channel: GestureChannel, cfg: StateMachineConfig = GESTURE_CONFIG.stateMachine) {
    this.channel = channel;
    this.cfg = cfg;
  }

  get current(): Readonly<ChannelState> {
    return this.state;
  }

  /** Gesture currently confirmed on this channel, if any. */
  get confirmed(): GestureType | null {
    return this.state.phase === 'CONFIRMED' ? this.state.gesture : null;
  }

  /** e.g. "JUMP_CANDIDATE", "NEUTRAL" — for debug display. */
  get label(): string {
    return this.state.gesture && this.state.phase !== 'NEUTRAL'
      ? `${this.state.gesture}_${this.state.phase}`
      : this.state.phase;
  }

  private enter(phase: GesturePhase, gesture: GestureType | null, t: number): void {
    this.state = { phase, gesture, since: t, frames: phase === 'CANDIDATE' ? 1 : 0 };
  }

  private blocked(gesture: GestureType, t: number): boolean {
    return this.cooldown !== null && this.cooldown.gesture === gesture && t < this.cooldown.until;
  }

  private event(type: GestureType, phase: 'start' | 'end', confidence: number, t: number, features: GestureEventFeatures): GestureEvent {
    return { type, phase, confidence, timestamp: t, features: { ...features }, source: 'pose-rules' };
  }

  /** Force-end the current gesture (e.g. tracking lost). */
  reset(t: number): GestureEvent[] {
    const events: GestureEvent[] = [];
    if (this.state.phase === 'CONFIRMED' && this.state.gesture) {
      events.push(this.event(this.state.gesture, 'end', 0, t, EMPTY_FEATURES));
    }
    this.cooldown = null;
    this.enter('NEUTRAL', null, t);
    return events;
  }

  update(c: Classification | null, features: GestureEventFeatures | null, t: number): GestureEvent[] {
    if (!c) return this.reset(t);
    const events: GestureEvent[] = [];
    const feats = features ?? EMPTY_FEATURES;
    const candidate = c.candidates[this.channel];

    if (this.state.phase === 'CONFIRMED' && this.state.gesture) {
      const g = this.state.gesture;
      const reading = c.readings[g];
      if (candidate && candidate !== g && GESTURE_PRIORITY[candidate] > GESTURE_PRIORITY[g]) {
        events.push(this.event(g, 'end', reading.confidence, t, feats));
        this.enter('CANDIDATE', candidate, t);
        return events;
      }
      if (reading.held) return events;
      events.push(this.event(g, 'end', reading.confidence, t, feats));
      this.cooldown = { gesture: g, until: t + this.cfg.cooldownMs };
      this.enter('COOLDOWN', g, t);
      return events;
    }

    if (this.state.phase === 'COOLDOWN') {
      if (t - this.state.since >= this.cfg.cooldownMs) {
        this.enter('NEUTRAL', null, t);
      } else if (!candidate || this.blocked(candidate, t)) {
        return events;
      }
    }

    if (this.state.phase === 'CANDIDATE' && this.state.gesture) {
      if (candidate === this.state.gesture) {
        this.state.frames += 1;
        const reading = c.readings[candidate];
        const stable = this.state.frames >= this.cfg.stableFrames && t - this.state.since >= this.cfg.stableMs;
        if (stable && reading.confidence >= this.cfg.requiredConfidence) {
          this.enter('CONFIRMED', candidate, t);
          events.push(this.event(candidate, 'start', reading.confidence, t, feats));
        }
        return events;
      }
      this.enter('NEUTRAL', null, t);
    }

    // NEUTRAL (or a COOLDOWN that allows a different gesture)
    if (candidate && !this.blocked(candidate, t) && c.readings[candidate].confidence >= this.cfg.requiredConfidence) {
      this.enter('CANDIDATE', candidate, t);
    }
    return events;
  }
}
