import type { Difficulty } from '../modes/difficulty';
import { BEAT_MS, DANCE_CONFIG, DANCE_POSES, type DanceMove, type DancePose } from './dance';

/**
 * The dance floor is a written choreography to one song, not a random list:
 * every part of the track has its own moves. Arms in the verse, a squat before
 * the drop, a jump right on it, steps and star jumps in the chorus, a breather,
 * and the final pose on the last chord. The music (see music.ts) plays the same
 * sections, so a jump always lands on the drop.
 */
export type SectionKind = 'intro' | 'verse' | 'build' | 'drop' | 'break' | 'outro';

export interface SongSection {
  kind: SectionKind;
  /** Shown on the dance floor while the section plays. */
  title: string;
  /** Beats [from, to). */
  from: number;
  to: number;
}

/** 144 beats at 120 bpm = 72 s. The 4-3-2-1 count runs on beats 4–7. */
export const SONG_BEATS = DANCE_CONFIG.beats;

export const SONG_SECTIONS: readonly SongSection[] = [
  { kind: 'intro', title: 'Разминка', from: 0, to: 16 },
  { kind: 'verse', title: 'Куплет', from: 16, to: 48 },
  { kind: 'build', title: 'Разгон', from: 48, to: 56 },
  { kind: 'drop', title: 'Припев', from: 56, to: 88 },
  { kind: 'break', title: 'Передышка', from: 88, to: 96 },
  { kind: 'verse', title: 'Второй куплет', from: 96, to: 104 },
  { kind: 'build', title: 'Разгон', from: 104, to: 112 },
  { kind: 'drop', title: 'Финальный припев', from: 112, to: 136 },
  { kind: 'outro', title: 'Финал', from: 136, to: SONG_BEATS },
];

export function sectionAt(beat: number): SongSection {
  return SONG_SECTIONS.find((s) => beat >= s.from && beat < s.to) ?? (SONG_SECTIONS[SONG_SECTIONS.length - 1] as SongSection);
}

/** 0 = Easy … 3 = Expert. */
const LEVEL: Record<Difficulty, number> = { easy: 0, normal: 1, hard: 2, expert: 3 };

/** [beat, pose id, first level that dances it, last level that dances it]. */
type Step = readonly [beat: number, pose: string, from: number, to: number];

const E = [0, 3] as const; // every level
const N = [1, 3] as const; // Normal and up
const H = [2, 3] as const; // Hard and up
const X = [3, 3] as const; // Expert only
const NH = [1, 2] as const; // Normal and Hard (Expert dances a faster variation instead)
const EZ = [0, 0] as const; // Easy only (keeps its steps going left and right in turn)

const at = (beat: number, pose: string, [from, to]: readonly [number, number]): Step => [beat, pose, from, to];

const SCRIPT: readonly Step[] = [
  // Разминка: two calm poses after the count.
  at(8, 'T', E),
  at(12, 'V', E),

  // Куплет: arms only — out to the sides, "airplane", then disco.
  at(16, 'L_OUT', E),
  at(18, 'R_OUT', N),
  at(20, 'T', E),
  at(22, 'LOW_V', N),
  at(24, 'R_OUT', E),
  at(26, 'L_OUT', N),
  at(28, 'T', E),
  at(30, 'LOW_V', N),
  at(32, 'DISCO_L', E),
  at(34, 'DISCO_R', NH),
  at(36, 'DISCO_L', NH),
  at(38, 'DISCO_R', NH),
  // Expert: disco on every beat.
  at(33, 'DISCO_R', X),
  at(34, 'DISCO_L', X),
  at(35, 'DISCO_R', X),
  at(36, 'DISCO_L', X),
  at(37, 'DISCO_R', X),
  at(38, 'DISCO_L', X),
  at(39, 'DISCO_R', X),
  at(40, 'Y_L', E),
  at(42, 'Y_R', N),
  at(44, 'V', E),
  at(46, 'T', H),

  // Разгон: hands up, a bounce, and a deep squat right before the drop.
  at(48, 'V', E),
  at(50, 'SQUAT_LOW', N),
  at(52, 'V', N),
  at(54, 'SQUAT_T', E),

  // Припев: the jump lands on the drop, then steps to both sides and star jumps.
  at(56, 'JUMP_V', E),
  at(58, 'T', N),
  at(60, 'STEP_L', E),
  at(62, 'STEP_R', N),
  at(64, 'STAR', E),
  at(65, 'SQUAT_LOW', X),
  at(66, 'LOW_V', H),
  at(68, 'STEP_L_DISCO', N),
  at(70, 'STEP_R_DISCO', E),
  at(72, 'JUMP_V', E),
  at(74, 'T', N),
  at(76, 'STEP_L', N),
  at(76, 'T', EZ),
  at(78, 'STEP_R', N),
  at(80, 'SQUAT_T', E),
  at(81, 'JUMP_V', X),
  at(82, 'V', H),
  at(84, 'STAR', E),
  at(86, 'V', N),

  // Передышка: slow disco and one arm up, then the other.
  at(88, 'DISCO_L', E),
  at(90, 'DISCO_R', N),
  at(92, 'L_UP', E),
  at(94, 'R_UP', N),

  // Второй куплет.
  at(96, 'L_OUT', E),
  at(97, 'R_OUT', X),
  at(98, 'R_OUT', NH),
  at(98, 'T', X),
  at(99, 'V', X),
  at(100, 'Y_L', E),
  at(102, 'Y_R', N),

  // Разгон: steps, hands up, a bounce on Expert — and a squat before the last drop.
  at(104, 'STEP_L', E),
  at(106, 'STEP_R', N),
  at(108, 'V', N),
  at(109, 'SQUAT_LOW', X),
  at(110, 'SQUAT_T', E),

  // Финальный припев: everything at once.
  at(112, 'JUMP_V', E),
  at(114, 'STEP_L_DISCO', N),
  at(116, 'STEP_R_DISCO', E),
  at(118, 'STAR', N),
  at(120, 'SQUAT_T', E),
  at(121, 'JUMP_V', X),
  at(122, 'T', H),
  at(124, 'STEP_L', E),
  at(126, 'STEP_R', N),
  at(128, 'STAR', E),
  at(129, 'SQUAT_LOW', X),
  at(130, 'DISCO_L', H),
  at(132, 'SQUAT_LOW', N),
  at(134, 'JUMP_V', E),

  // Финал: the last pose on the last chord.
  at(136, 'T', N),
  at(138, 'V', E),
];

function pose(id: string): DancePose {
  const found = DANCE_POSES.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown dance pose: ${id}`);
  return found;
}

/** The song's choreography at this difficulty: the same dance, more or fewer moves. */
export function scriptedChoreography(difficulty: Difficulty): DanceMove[] {
  const level = LEVEL[difficulty];
  return SCRIPT.filter(([, , from, to]) => level >= from && level <= to)
    .sort((a, b) => a[0] - b[0])
    .map(([beat, id], i) => ({ id: i, pose: pose(id), beat, at: beat * BEAT_MS }));
}
