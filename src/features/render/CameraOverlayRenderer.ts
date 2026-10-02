import { GESTURE_CONFIG } from '../../config/gesture.config';
import { midpoint, type Point } from '../../lib/math/geometry';
import { xOfZone } from '../gestures/calibration';
import type { MotionFrame } from '../engine/MotionEngine';
import { isErrorVerdict } from '../gestures/ErrorDiagnosisEngine';
import { targetGuides } from '../gestures/targetPose';
import type { GestureType } from '../gestures/types';
import { BODY_PART_JOINTS, LM, lm, type BodyPart, type Pose } from '../tracking/landmarks';
import type { StandZone } from '../versus/PlayerTracker';
import { coverMapping, mapLen, mapX, mapY, observeCanvas, type ViewMapping } from './canvas';
import { PALETTE, rgba } from './palette';
import { drawArrow, drawSkeleton, MotionTrail, type Projector } from './skeletonRenderer';

/** Standing play with lanes = parts of the picture, and the screen wants a lane change. */
function isLaneMove(frame: Readonly<MotionFrame>): boolean {
  const e = frame.expected;
  return (e === 'LEAN_LEFT' || e === 'LEAN_RIGHT' || e === 'CENTER') && frame.baseline?.mode === 'full' && frame.baseline.region !== undefined;
}

/** P1 / P2 colours (the same as on the game screens). */
const PLAYER_TINTS = [PALETTE.cyan, PALETTE.warn] as const;

const GESTURE_PARTS: Record<GestureType, BodyPart[]> = {
  LEAN_LEFT: ['shoulders', 'torso'],
  LEAN_RIGHT: ['shoulders', 'torso'],
  JUMP: ['leftArm', 'rightArm'],
  CROUCH: ['hips', 'legs'],
};

function jointSet(parts: readonly BodyPart[]): Set<number> {
  const out = new Set<number>();
  for (const part of parts) for (const j of BODY_PART_JOINTS[part]) out.add(j);
  return out;
}

export interface OverlayOptions {
  /** Draw error-mode guidance: ghost pose, target lines, arrows. */
  guidance: boolean;
  /** Draw the light trail behind hands and head. */
  trail: boolean;
  /** Two-player setup: where each player should stand ([P1, P2]). */
  standZones?: readonly (StandZone | null)[];
}

/**
 * Draws on top of the mirrored camera feed: the live skeleton, gesture
 * highlights, and — in error mode — the ghost target pose, threshold lines
 * and arrows from the current joint to where it must go.
 *
 * Draws the display-smoothed pose (eased every frame toward the latest
 * inference) at a quality-dependent cadence: 60 fps on capable machines,
 * 30 fps when the governor has stepped quality down.
 */
export class CameraOverlayRenderer {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly sizing: ReturnType<typeof observeCanvas>;
  private readonly trail = new MotionTrail([LM.LEFT_WRIST, LM.RIGHT_WRIST, LM.NOSE], 9);
  private mapping: ViewMapping = coverMapping(1, 1, 640, 480);
  private readonly projector: Projector = {
    x: (v) => mapX(v, this.mapping),
    y: (v) => mapY(v, this.mapping),
    len: (v) => mapLen(v, this.mapping),
  };
  private lastDrawAt = -Infinity;
  private cleared = true;
  private lastWidth = 0;
  private lastHeight = 0;
  private lastDpr = 0;
  private highlightKey = '';
  private highlight: Set<number> = new Set();
  private errorKey = '';
  private errorJoints: Set<number> = new Set();

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d');
    this.sizing = observeCanvas(canvas);
  }

  dispose(): void {
    this.sizing.dispose();
  }

  render(frame: Readonly<MotionFrame>, now: number, opts: OverlayOptions): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.sizing.setMaxDpr(frame.render.maxDpr);
    const { width, height, dpr } = this.sizing.size;
    if (frame.players.length > 0) {
      this.renderPlayers(ctx, frame, now, width, height, dpr, opts.standZones);
      return;
    }
    const pose = frame.displayPose;

    if (!pose) {
      if (!this.cleared) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        this.cleared = true;
      }
      this.trail.clear();
      return;
    }

    const diagnosis = frame.diagnosis;
    const errorMode = opts.guidance && diagnosis !== null && isErrorVerdict(diagnosis.verdict);
    // A backing-store resize (CSS size or DPR change) wipes the canvas, so it forces a redraw.
    const resized = width !== this.lastWidth || height !== this.lastHeight || dpr !== this.lastDpr;
    // Otherwise redraw at the quality level's cadence (60 fps high, 30 fps medium/low).
    if (!resized && now - this.lastDrawAt < frame.render.overlayIntervalMs - 1) return;
    this.lastDrawAt = now;
    this.lastWidth = width;
    this.lastHeight = height;
    this.lastDpr = dpr;
    this.cleared = false;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    this.mapping = coverMapping(width, height, frame.videoWidth, frame.videoHeight);
    const success = diagnosis?.verdict === 'correct';
    this.updateJointSets(frame, opts.guidance);
    // Standing play: a lane change is shown as "go to this zone" — a whole ghost skeleton
    // half a picture away from the player looked like the tracking had come off the body.
    const laneMove = isLaneMove(frame);
    if (opts.guidance) this.drawLaneZones(ctx, frame, pose, width, height, now, laneMove && !success);

    if (opts.trail) {
      this.trail.push(pose, this.projector);
      this.trail.draw(ctx, success ? PALETTE.success : PALETTE.cyan, Math.max(2, this.projector.len(0.006)), 1, frame.render.trailLength);
    }

    if (opts.guidance && diagnosis && frame.baseline && frame.expected && !success && !laneMove) {
      this.drawGuides(ctx, frame, pose, width, height);
      if (frame.target) {
        drawSkeleton(ctx, frame.target, this.projector, { tone: 'ghost', alpha: 0.9 });
        this.drawCorrectionArrows(ctx, pose, frame.target, diagnosis.verdict === 'idle' ? PALETTE.cyan : PALETTE.warn);
      }
    }

    drawSkeleton(ctx, pose, this.projector, {
      tone: !frame.trackable ? 'dim' : success ? 'success' : 'tracking',
      highlight: this.highlight,
      errorJoints: errorMode ? this.errorJoints : undefined,
      pulse: (now % 900) / 900,
      glow: frame.render.glow,
    });
  }

  /**
   * Standing play: lanes are parts of the picture. Shows the three zones and
   * lights the one the player is in, so moving between lanes is obvious.
   */
  private drawLaneZones(
    ctx: CanvasRenderingContext2D,
    frame: Readonly<MotionFrame>,
    pose: Pose,
    width: number,
    height: number,
    now: number,
    showTarget: boolean,
  ): void {
    const baseline = frame.baseline;
    const region = baseline?.region;
    if (!baseline || baseline.mode !== 'full' || !region) return;
    const border = GESTURE_CONFIG.body.step.activation;
    const xl = this.projector.x(xOfZone(-border, region));
    const xr = this.projector.x(xOfZone(border, region));
    const lateral = frame.lateral.phase === 'CONFIRMED' ? frame.lateral.gesture : null;
    const active = lateral === 'LEAN_LEFT' ? 0 : lateral === 'LEAN_RIGHT' ? 2 : 1;
    const zones: [number, number, string][] = [
      [0, xl, 'ЛЕВО'],
      [xl, xr, 'ЦЕНТР'],
      [xr, width, 'ПРАВО'],
    ];
    ctx.save();
    zones.forEach(([x0, x1, name], i) => {
      const a = Math.max(0, Math.min(x0, x1));
      const b = Math.min(width, Math.max(x0, x1));
      if (i === active) {
        ctx.globalAlpha = 0.1;
        ctx.fillStyle = PALETTE.cyan;
        ctx.fillRect(a, 0, b - a, height);
      }
      ctx.globalAlpha = i === active ? 0.95 : 0.45;
      ctx.fillStyle = i === active ? PALETTE.cyan : PALETTE.white;
      ctx.font = '700 12px Manrope, system-ui, sans-serif';
      ctx.textAlign = 'center';
      // Upper part of the picture: clear of the corner tags and the gesture badges.
      ctx.fillText(name, (a + b) / 2, Math.max(48, height * 0.2));
    });
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = PALETTE.white;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 8]);
    for (const x of [xl, xr]) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // Where to go: the target zone pulses and an arrow leads there from the player.
    const expected = frame.expected;
    const target = expected === 'LEAN_LEFT' ? 0 : expected === 'LEAN_RIGHT' ? 2 : expected === 'CENTER' ? 1 : -1;
    const zone = zones[target];
    if (showTarget && zone && target !== active) {
      const a = Math.max(0, Math.min(zone[0], zone[1]));
      const b = Math.min(width, Math.max(zone[0], zone[1]));
      ctx.globalAlpha = 0.1 + 0.08 * (0.5 + 0.5 * Math.sin(now / 160));
      ctx.fillStyle = PALETTE.warn;
      ctx.fillRect(a, 0, b - a, height);
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = PALETTE.warn;
      ctx.font = '800 14px Manrope, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('ИДИ СЮДА', (a + b) / 2, Math.max(70, height * 0.2) + 20);
      // From the chest (always in the picture) toward the zone to step into.
      const chest = midpoint(lm(pose, LM.LEFT_SHOULDER), lm(pose, LM.RIGHT_SHOULDER));
      const from = { x: this.projector.x(chest.x), y: this.projector.y(chest.y) + this.projector.len(0.05) };
      drawArrow(ctx, from, { x: (a + b) / 2, y: from.y }, PALETTE.warn, Math.max(12, this.projector.len(0.035)), 0.95);
    }
    ctx.restore();
  }

  /**
   * Two-player mode: both skeletons in their player colours, each half of the
   * picture softly tinted, the middle line both players must not cross and,
   * during setup, the zone each player should stand in.
   */
  private renderPlayers(
    ctx: CanvasRenderingContext2D,
    frame: Readonly<MotionFrame>,
    now: number,
    width: number,
    height: number,
    dpr: number,
    standZones: readonly (StandZone | null)[] | undefined,
  ): void {
    const resized = width !== this.lastWidth || height !== this.lastHeight || dpr !== this.lastDpr;
    if (!resized && now - this.lastDrawAt < frame.render.overlayIntervalMs - 1) return;
    this.lastDrawAt = now;
    this.lastWidth = width;
    this.lastHeight = height;
    this.lastDpr = dpr;
    this.cleared = false;
    this.trail.clear();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    this.mapping = coverMapping(width, height, frame.videoWidth || 640, frame.videoHeight || 480);
    const mid = this.projector.x(frame.aspect / 2);
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = PLAYER_TINTS[0];
    ctx.fillRect(0, 0, mid, height);
    ctx.fillStyle = PLAYER_TINTS[1];
    ctx.fillRect(mid, 0, width - mid, height);
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = PALETTE.white;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(mid, 0);
    ctx.lineTo(mid, height);
    ctx.stroke();
    ctx.restore();
    standZones?.forEach((zone, i) => {
      if (zone) this.drawStandZone(ctx, zone, frame.displayPlayers[i] ?? null, PLAYER_TINTS[i] ?? PALETTE.cyan, height, now);
    });
    frame.displayPlayers.forEach((pose, i) => {
      if (pose) drawSkeleton(ctx, pose, this.projector, { tone: 'tracking', tint: PLAYER_TINTS[i], glow: frame.render.glow });
    });
  }

  /** Two-player setup: the band to stand in (pulsing until the player is inside) and an arrow toward it. */
  private drawStandZone(ctx: CanvasRenderingContext2D, zone: StandZone, pose: Pose | null, tint: string, height: number, now: number): void {
    const a = this.projector.x(zone.x0);
    const b = this.projector.x(zone.x1);
    const x0 = Math.min(a, b);
    const x1 = Math.max(a, b);
    const color = zone.ok ? PALETTE.success : tint;
    ctx.save();
    ctx.globalAlpha = zone.ok ? 0.16 : 0.1 + 0.08 * (0.5 + 0.5 * Math.sin(now / 200));
    ctx.fillStyle = color;
    ctx.fillRect(x0, 0, x1 - x0, height);
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    for (const x of [x0, x1]) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = color;
    ctx.font = '800 13px Manrope, system-ui, sans-serif';
    ctx.textAlign = 'center';
    // Upper part of the picture: below the corner tags, above the players' heads.
    ctx.fillText(zone.ok ? 'СТОЙ ЗДЕСЬ' : 'ВСТАНЬ СЮДА', (x0 + x1) / 2, Math.max(56, height * 0.16));
    if (!zone.ok && pose) {
      // From the player's chest toward the zone.
      const chest = midpoint(lm(pose, LM.LEFT_SHOULDER), lm(pose, LM.RIGHT_SHOULDER));
      const from = { x: this.projector.x(chest.x), y: this.projector.y(chest.y) + this.projector.len(0.05) };
      const inset = Math.min(24, (x1 - x0) / 2);
      if (from.x < x0 || from.x > x1) {
        drawArrow(ctx, from, { x: from.x < x0 ? x0 + inset : x1 - inset, y: from.y }, tint, Math.max(12, this.projector.len(0.035)), 0.95);
      }
    }
    ctx.restore();
  }

  /** Rebuild highlight / error joint sets only when the gesture or diagnosis changes. */
  private updateJointSets(frame: Readonly<MotionFrame>, guidance: boolean): void {
    const lateral = frame.lateral.phase === 'CONFIRMED' ? frame.lateral.gesture : null;
    const vertical = frame.vertical.phase === 'CONFIRMED' ? frame.vertical.gesture : null;
    const diagnosis = frame.diagnosis;
    const idleFocus = guidance && diagnosis?.verdict === 'idle' ? diagnosis.focus : null;
    const hKey = `${lateral}|${vertical}|${idleFocus?.join(',') ?? ''}`;
    if (hKey !== this.highlightKey) {
      this.highlightKey = hKey;
      const parts: BodyPart[] = [];
      if (lateral) parts.push(...GESTURE_PARTS[lateral]);
      if (vertical) parts.push(...GESTURE_PARTS[vertical]);
      if (idleFocus) parts.push(...idleFocus);
      this.highlight = jointSet(parts);
    }
    const eKey = diagnosis ? diagnosis.focus.join(',') : '';
    if (eKey !== this.errorKey) {
      this.errorKey = eKey;
      this.errorJoints = jointSet(diagnosis?.focus ?? []);
    }
  }

  private drawGuides(ctx: CanvasRenderingContext2D, frame: Readonly<MotionFrame>, pose: Pose, width: number, height: number): void {
    const baseline = frame.baseline;
    const expected = frame.expected;
    if (!baseline || !expected) return;
    const shoulderY = midpoint(lm(pose, LM.LEFT_SHOULDER), lm(pose, LM.RIGHT_SHOULDER)).y;
    ctx.save();
    ctx.font = '600 11px "JetBrains Mono", ui-monospace, monospace';
    ctx.textBaseline = 'bottom';
    ctx.strokeStyle = rgba(PALETTE.cyan, 0.75);
    ctx.fillStyle = rgba(PALETTE.cyan, 0.95);
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    for (const guide of targetGuides(expected, baseline, shoulderY)) {
      ctx.beginPath();
      if (guide.orientation === 'horizontal') {
        const y = this.projector.y(guide.value);
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        if (guide.label) ctx.fillText(guide.label, 12, y - 6);
      } else {
        const x = this.projector.x(guide.value);
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        if (guide.label) {
          const tw = ctx.measureText(guide.label).width;
          ctx.fillText(guide.label, Math.min(Math.max(x - tw / 2, 8), width - tw - 8), 24);
        }
      }
    }
    ctx.restore();
  }

  private drawCorrectionArrows(ctx: CanvasRenderingContext2D, pose: Pose, target: Pose, color: string): void {
    const size = Math.max(10, this.projector.len(0.03));
    const toScreen = (p: Point): Point => ({ x: this.projector.x(p.x), y: this.projector.y(p.y) });
    const pairs: Array<[Point, Point]> = [];
    for (const index of [LM.LEFT_WRIST, LM.RIGHT_WRIST]) {
      pairs.push([lm(pose, index), lm(target, index)]);
    }
    pairs.push([
      midpoint(lm(pose, LM.LEFT_SHOULDER), lm(pose, LM.RIGHT_SHOULDER)),
      midpoint(lm(target, LM.LEFT_SHOULDER), lm(target, LM.RIGHT_SHOULDER)),
    ]);
    for (const [from, to] of pairs) {
      const a = toScreen(from);
      const b = toScreen(to);
      if (Math.hypot(b.x - a.x, b.y - a.y) > size * 2.2) drawArrow(ctx, a, b, color, size, 0.95);
    }
  }
}
