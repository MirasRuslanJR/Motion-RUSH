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
  /** Average time the player was in position before the obstacle arrived (ms). */
  avgLeadMs: number | null;
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
  avgLeadMs: number | null;
}

const MOVE_ORDER: ExpectedMotion[] = ['LEAN_LEFT', 'LEAN_RIGHT', 'JUMP', 'CROUCH', 'CENTER'];

/** Better accuracy first; then being ready earlier; then more practice. */
function byStrength(a: MoveStats, b: MoveStats): number {
  if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
  const la = a.avgLeadMs ?? -1;
  const lb = b.avgLeadMs ?? -1;
  if (la !== lb) return lb - la;
  return b.attempts - a.attempts;
}

const leads = (values: (number | null)[]) => values.filter((v): v is number => v !== null);

/** All numbers come from the recorded run — nothing is estimated or faked. */
export function computeSessionStats(result: SessionResult): SessionStats {
  const records = result.obstacles;
  const cleared = records.filter((r) => r.result !== 'miss');
  const allLeads = leads(cleared.map((r) => r.leadMs));

  const perMove: MoveStats[] = MOVE_ORDER.map((motion) => {
    const rs = records.filter((r) => r.required === motion);
    const ok = rs.filter((r) => r.result !== 'miss');
    const moveLeads = leads(ok.map((r) => r.leadMs));
    return {
      motion,
      attempts: rs.length,
      cleared: ok.length,
      perfect: rs.filter((r) => r.result === 'perfect').length,
      accuracy: rs.length ? ok.length / rs.length : 0,
      avgLeadMs: moveLeads.length ? mean(moveLeads) : null,
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
    avgLeadMs: allLeads.length ? mean(allLeads) : null,
  };
}
