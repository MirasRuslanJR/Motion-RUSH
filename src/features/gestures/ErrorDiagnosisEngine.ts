import { GESTURE_CONFIG } from '../../config/gesture.config';
import { clamp } from '../../lib/math/geometry';
import type { BodyPart } from '../tracking/landmarks';
import type { Baseline } from './calibration';
import { DIAGNOSIS_RULES, metricCaption, type DiagnosisRule, type RuleContext, type Verdict } from './diagnosisRules';
import type { BodyFeatures } from './FeatureExtractor';
import type { Classification } from './GestureClassifier';
import { lateralOffset } from './thresholds';
import { schemeOf, type Arrow, type ExpectedMotion } from './types';

export interface Diagnosis {
  expected: ExpectedMotion;
  verdict: Verdict;
  ruleId: string;
  message: string;
  focus: BodyPart[];
  arrow: Arrow | null;
  /** Caption for the progress meter, e.g. "Высота рук". */
  metric: string;
  /** Live progress toward the target: 0..1 (1 = target reached). */
  progress: number;
  timestamp: number;
}

export type ErrorVerdict = Extract<Verdict, 'near' | 'wrong' | 'other'>;

export function isErrorVerdict(verdict: Verdict): verdict is ErrorVerdict {
  return verdict === 'near' || verdict === 'wrong' || verdict === 'other';
}

const RULES = new Map<string, DiagnosisRule[]>();
for (const rule of DIAGNOSIS_RULES) {
  for (const expected of rule.expects) {
    for (const scheme of rule.schemes ?? (['body', 'seated'] as const)) {
      const key = `${scheme}:${expected}`;
      const list = RULES.get(key) ?? [];
      list.push(rule);
      RULES.set(key, list);
    }
  }
}
for (const list of RULES.values()) list.sort((a, b) => b.priority - a.priority);

function progressFor(expected: ExpectedMotion, lateral: number, c: Classification): number {
  if (expected === 'CENTER') {
    const tol = GESTURE_CONFIG.center.tolerance;
    const off = Math.abs(lateral);
    return off <= tol ? 1 : clamp(1 - (off - tol) / GESTURE_CONFIG.lean.activation, 0, 1);
  }
  return clamp(c.readings[expected].progress, 0, 1);
}

/**
 * Pure diagnosis: evaluates the rule table for the expected motion and
 * returns the highest-priority matching rule. Deterministic for a given frame.
 */
export function diagnose(
  expected: ExpectedMotion,
  f: BodyFeatures,
  c: Classification,
  baseline: Baseline,
  timestamp = 0,
): Diagnosis {
  const scheme = schemeOf(baseline.mode);
  const lateral = lateralOffset(f, scheme);
  const ctx: RuleContext = {
    expected,
    scheme,
    f,
    c,
    baseline,
    reading: expected === 'CENTER' ? null : c.readings[expected],
    dir: expected === 'LEAN_LEFT' ? -1 : expected === 'LEAN_RIGHT' ? 1 : 0,
    lateral,
  };
  const rules = RULES.get(`${scheme}:${expected}`) ?? [];
  const rule = rules.find((r) => r.when(ctx)) ?? rules[rules.length - 1];
  if (!rule) throw new Error(`No diagnosis rules for ${expected}`);
  const out = rule.build(ctx);
  return {
    expected,
    verdict: rule.verdict,
    ruleId: rule.id,
    message: out.message,
    focus: out.focus,
    arrow: out.arrow,
    metric: metricCaption(expected, scheme),
    progress: progressFor(expected, lateral, c),
    timestamp,
  };
}

interface HintConfig {
  readonly debounceMs: number;
  readonly minDisplayMs: number;
}

/**
 * Turns the per-frame diagnosis stream into calm, readable hints:
 * a new hint must persist `debounceMs`, and a shown hint stays at least
 * `minDisplayMs` — unless the user just succeeded, which is shown instantly.
 */
export class HintScheduler {
  private readonly cfg: HintConfig;
  private shown: Diagnosis | null = null;
  private shownAt = 0;
  private pendingKey: string | null = null;
  private pendingSince = 0;

  constructor(cfg: HintConfig = GESTURE_CONFIG.hints) {
    this.cfg = cfg;
  }

  get current(): Diagnosis | null {
    return this.shown;
  }

  reset(): void {
    this.shown = null;
    this.pendingKey = null;
  }

  /** Returns true when the displayed hint changed. */
  update(raw: Diagnosis | null, t: number): boolean {
    if (!raw) {
      const changed = this.shown !== null;
      this.reset();
      return changed;
    }
    const key = `${raw.expected}|${raw.ruleId}|${raw.message}`;
    const shownKey = this.shown ? `${this.shown.expected}|${this.shown.ruleId}|${this.shown.message}` : null;
    if (key === shownKey) {
      this.pendingKey = null;
      return false;
    }

    const immediate =
      !this.shown || this.shown.expected !== raw.expected || (raw.verdict === 'correct' && this.shown.verdict !== 'correct');
    if (immediate) return this.show(raw, t);

    if (this.pendingKey !== key) {
      this.pendingKey = key;
      this.pendingSince = t;
      return false;
    }
    const settled = t - this.pendingSince >= this.cfg.debounceMs;
    const shownLongEnough = t - this.shownAt >= this.cfg.minDisplayMs || this.shown?.verdict === 'idle';
    return settled && shownLongEnough ? this.show(raw, t) : false;
  }

  private show(d: Diagnosis, t: number): boolean {
    this.shown = d;
    this.shownAt = t;
    this.pendingKey = null;
    return true;
  }
}
