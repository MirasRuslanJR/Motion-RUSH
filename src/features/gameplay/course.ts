import { GAME_CONFIG, type CoursePhase } from '../../config/game.config';
import { OBSTACLE_REQUIREMENT, type CourseItem, type Lane, type ObstacleKind } from './types';

/** mulberry32 — tiny deterministic PRNG. Same seed → same course. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function openLane(kind: ObstacleKind): Lane {
  return kind === 'GATE_LEFT' ? -1 : kind === 'GATE_RIGHT' ? 1 : 0;
}

function sideOf(kind: ObstacleKind): Lane {
  const req = kind === 'ORB' ? null : OBSTACLE_REQUIREMENT[kind];
  return req === 'LEAN_LEFT' ? -1 : req === 'LEAN_RIGHT' ? 1 : 0;
}

type CourseConfig = typeof GAME_CONFIG.course;

function phaseAt(time: number, phases: readonly CoursePhase[]): CoursePhase | null {
  return phases.find((p) => time < p.untilMs) ?? null;
}

/**
 * Generates the full obstacle course up front.
 * Constraints keep it fair for camera input: every move is introduced once,
 * no more than two identical obstacles in a row, and extra time for
 * left↔right crossovers.
 */
export function generateCourse(seed: number = GAME_CONFIG.seed, cfg: CourseConfig = GAME_CONFIG.course): CourseItem[] {
  const rng = createRng(seed);
  const items: CourseItem[] = [];
  let id = 0;
  let time = cfg.firstArrivalMs;
  let introIndex = 0;
  let prev: ObstacleKind | null = null;
  let prevPrev: ObstacleKind | null = null;

  for (;;) {
    const phase = phaseAt(time, cfg.phases);
    if (!phase) break;

    let kind: ObstacleKind;
    if (introIndex < cfg.intro.length) {
      kind = cfg.intro[introIndex] ?? 'HURDLE';
      introIndex++;
    } else {
      const options = phase.kinds.filter((k) => !(k === prev && k === prevPrev));
      kind = options[Math.floor(rng() * options.length)] ?? 'HURDLE';
    }

    if (prev) {
      const crossover = sideOf(prev) !== 0 && sideOf(kind) === -sideOf(prev);
      if (crossover) time += cfg.crossoverPenaltyMs;
    }

    items.push({ id: id++, kind, arriveAt: time, leadMs: phase.leadMs, lane: openLane(kind) });

    const [minGap, maxGap] = phase.gapMs;
    const gap = minGap + rng() * (maxGap - minGap);
    if (rng() < phase.orbChance) {
      const lanes: Lane[] = [-1, 0, 1];
      const lane = lanes[Math.floor(rng() * lanes.length)] ?? 0;
      items.push({ id: id++, kind: 'ORB', arriveAt: time + gap / 2, leadMs: phase.leadMs, lane });
    }

    prevPrev = prev;
    prev = kind;
    time += gap;
  }
  return items.sort((a, b) => a.arriveAt - b.arriveAt);
}

export function courseDuration(course: readonly CourseItem[], cfg: CourseConfig = GAME_CONFIG.course): number {
  const last = course[course.length - 1];
  return (last?.arriveAt ?? 0) + cfg.endPaddingMs;
}
