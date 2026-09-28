import { mean } from '../../lib/math/geometry';
import type { ExpectedMotion } from '../gestures/types';
import type { SessionResult } from '../gameplay/types';

export interface MoveStats {
  motion: ExpectedMotion;
  attempts: number;
  cleared: number;
  perfect: number;
  /** 0..1 */
  accuracy: number;
  avgReactionMs: number | null;
}

export interface MistakeStat {
  ruleId: string;
  message: string;
  count: number;
}

export interface SessionStats {
  total: number;
  cleared: number;
  perfect: number;
  misses: number;
  /** Cleared / total, 0..1. */
  accuracy: number;
  perMove: MoveStats[];
  strongest: MoveStats | null;
  needsWork: MoveStats | null;
  /** Obstacles where an error hint was shown and then the player got it right. */
  errorsCorrected: number;
  hintsShown: number;
  topMistakes: MistakeStat[];
  avgReactionMs: number | null;
}

const MOVE_ORDER: ExpectedMotion[] = ['LEAN_LEFT', 'LEAN_RIGHT', 'JUMP', 'CROUCH', 'CENTER'];

function byStrength(a: MoveStats, b: MoveStats): number {
  if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
  const ra = a.avgReactionMs ?? Number.POSITIVE_INFINITY;
  const rb = b.avgReactionMs ?? Number.POSITIVE_INFINITY;
  if (ra !== rb) return ra - rb;
  return b.attempts - a.attempts;
}

/** All numbers come from the recorded run — nothing is estimated or faked. */
export function computeSessionStats(result: SessionResult): SessionStats {
  const records = result.obstacles;
  const cleared = records.filter((r) => r.result !== 'miss');
  const reactions = cleared.map((r) => r.reactionMs).filter((v): v is number => v !== null);

  const perMove: MoveStats[] = MOVE_ORDER.map((motion) => {
    const rs = records.filter((r) => r.required === motion);
    const ok = rs.filter((r) => r.result !== 'miss');
    const rt = ok.map((r) => r.reactionMs).filter((v): v is number => v !== null);
    return {
      motion,
      attempts: rs.length,
      cleared: ok.length,
      perfect: rs.filter((r) => r.result === 'perfect').length,
      accuracy: rs.length ? ok.length / rs.length : 0,
      avgReactionMs: rt.length ? mean(rt) : null,
    };
  }).filter((m) => m.attempts > 0);

  const ranked = [...perMove].sort(byStrength);
  const eligible = ranked.filter((m) => m.attempts >= 2);
  const strongest = (eligible.length ? eligible : ranked)[0] ?? null;
  const rest = ranked.filter((m) => m !== strongest);
  const needsWork = rest.length ? (rest[rest.length - 1] ?? null) : null;

  const mistakes = new Map<string, MistakeStat>();
  for (const r of records) {
    if (!r.missReason) continue;
    const key = `${r.missReason.ruleId}|${r.missReason.message}`;
    const existing = mistakes.get(key);
    if (existing) existing.count++;
    else mistakes.set(key, { ...r.missReason, count: 1 });
  }

  return {
    total: records.length,
    cleared: cleared.length,
    perfect: records.filter((r) => r.result === 'perfect').length,
    misses: records.length - cleared.length,
    accuracy: records.length ? cleared.length / records.length : 0,
    perMove,
    strongest,
    needsWork,
    errorsCorrected: records.filter((r) => r.corrected).length,
    hintsShown: result.hintsShown,
    topMistakes: [...mistakes.values()].sort((a, b) => b.count - a.count).slice(0, 3),
    avgReactionMs: reactions.length ? mean(reactions) : null,
  };
}
