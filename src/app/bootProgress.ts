/** What the loading screen waits for, and how far along it is. Pure, so it is unit-tested. */
export interface BootStatus {
  fonts: boolean;
  /** Share of the art (mode covers, track sprites, horizon) loaded, 0..1. */
  art: number;
  /** The pose model is ready (or failed: the camera setup reports that later). */
  model: boolean;
}

export type BootStep = 'fonts' | 'art' | 'model' | 'done';

export const BOOT_LABELS: Record<BootStep, string> = {
  fonts: 'Шрифты',
  art: 'Арт режимов и трассы',
  model: 'Модель распознавания позы',
  done: 'Всё загружено',
};

/** Squares in the progress bar. */
export const BOOT_SQUARES = 24;

const WEIGHT = { fonts: 0.1, art: 0.2, model: 0.7 };
/** The model reports no progress of its own: its share fills on a curve while it loads (never past 90%). */
const MODEL_CURVE_MS = 3000;

export function bootDone(s: BootStatus): boolean {
  return s.fonts && s.art >= 1 && s.model;
}

/** The first unfinished step, in the order they are shown. */
export function bootStep(s: BootStatus): BootStep {
  if (!s.fonts) return 'fonts';
  if (s.art < 1) return 'art';
  if (!s.model) return 'model';
  return 'done';
}

/** 0..1; `elapsedMs` is the time since loading started. */
export function bootProgress(s: BootStatus, elapsedMs: number): number {
  if (bootDone(s)) return 1;
  const model = s.model ? 1 : 0.9 * (1 - Math.exp(-Math.max(0, elapsedMs) / MODEL_CURVE_MS));
  const art = Math.min(1, Math.max(0, s.art));
  return WEIGHT.fonts * (s.fonts ? 1 : 0) + WEIGHT.art * art + WEIGHT.model * model;
}
