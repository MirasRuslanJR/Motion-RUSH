import { TRACKING_CONFIG } from '../../config/tracking.config';
import { distance, midpoint } from '../../lib/math/geometry';
import { LM, lm, type Pose } from './landmarks';

export type TrackingStatus = 'NO_BODY' | 'PARTIAL' | 'TOO_CLOSE' | 'TOO_FAR' | 'OFF_CENTER' | 'OK';

export interface FrameQuality {
  status: TrackingStatus;
  /** Min visibility of nose + both shoulders. */
  coreVisibility: number;
  hipsVisible: boolean;
  /** Shoulder width in frame units (0 when no body). */
  shoulderWidth: number;
  /** Raised hands would leave the top of the frame. */
  lowHeadroom: boolean;
  /** For OFF_CENTER: which way the user should move (-1 = to their left, 1 = right). */
  moveDirection: -1 | 0 | 1;
}

type QualityConfig = typeof TRACKING_CONFIG.quality;

export const NO_BODY_QUALITY: FrameQuality = {
  status: 'NO_BODY',
  coreVisibility: 0,
  hipsVisible: false,
  shoulderWidth: 0,
  lowHeadroom: false,
  moveDirection: 0,
};

/**
 * Decides whether a frame is usable for gesture recognition and, if not,
 * WHY — so the UI can tell the user exactly what to change.
 * Priority: nothing detected > partial body > distance > framing.
 */
export function assessFrame(pose: Pose | null, aspect: number, q: QualityConfig = TRACKING_CONFIG.quality): FrameQuality {
  if (!pose) return NO_BODY_QUALITY;

  const ls = lm(pose, LM.LEFT_SHOULDER);
  const rs = lm(pose, LM.RIGHT_SHOULDER);
  const nose = lm(pose, LM.NOSE);
  const lh = lm(pose, LM.LEFT_HIP);
  const rh = lm(pose, LM.RIGHT_HIP);

  const coreVisibility = Math.min(ls.v, rs.v, nose.v);
  const hipsVisible = Math.min(lh.v, rh.v) >= q.minHipVisibility && lh.y < 1 && rh.y < 1;
  const shoulderWidth = distance(ls, rs);
  const center = midpoint(ls, rs);
  const shoulderLineY = Math.min(ls.y, rs.y);
  const lowHeadroom = shoulderLineY < shoulderWidth * q.headroomShoulderWidths;

  const base: FrameQuality = {
    status: 'OK',
    coreVisibility,
    hipsVisible,
    shoulderWidth,
    lowHeadroom,
    moveDirection: 0,
  };

  if (coreVisibility < q.minCoreVisibility) return { ...base, status: 'PARTIAL' };
  if (shoulderWidth > q.tooCloseShoulderWidth) return { ...base, status: 'TOO_CLOSE' };
  if (shoulderWidth < q.tooFarShoulderWidth) return { ...base, status: 'TOO_FAR' };

  const relX = center.x / aspect;
  if (relX < q.centerMargin) return { ...base, status: 'OFF_CENTER', moveDirection: 1 };
  if (relX > 1 - q.centerMargin) return { ...base, status: 'OFF_CENTER', moveDirection: -1 };

  return base;
}

/** Enough body is visible to read gestures (framing issues are only advisory). */
export function isTrackable(status: TrackingStatus): boolean {
  return status !== 'NO_BODY' && status !== 'PARTIAL';
}

export function trackingMessage(quality: FrameQuality): string {
  switch (quality.status) {
    case 'NO_BODY':
      return 'Встань перед камерой — тебя пока не видно';
    case 'PARTIAL':
      return 'Покажи в кадре голову и оба плеча';
    case 'TOO_CLOSE':
      return 'Отойди на шаг назад — рукам нужно место в кадре';
    case 'TOO_FAR':
      return 'Подойди ближе к камере';
    case 'OFF_CENTER':
      return quality.moveDirection > 0 ? 'Сдвинься правее — в центр кадра' : 'Сдвинься левее — в центр кадра';
    case 'OK':
      return quality.lowHeadroom ? 'Отойди чуть дальше — поднятые руки выйдут за кадр' : 'Тебя отлично видно';
  }
}
