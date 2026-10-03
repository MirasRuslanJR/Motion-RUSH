import { clamp, distance, midpoint, type Point } from '../../lib/math/geometry';
import { BEAT_MS, DANCE_CONFIG, type BodyOffset, type DanceGrade, type DanceMove, type DancePose } from '../dance/dance';
import { LM, lm, type Pose } from '../tracking/landmarks';
import { observeCanvas } from './canvas';
import { PALETTE, rgba } from './palette';

export const PLAYER_COLORS = [PALETTE.cyan, PALETTE.warn] as const;

const GRADE_COLOR: Record<DanceGrade, string> = { perfect: PALETTE.success, good: PALETTE.cyan, miss: PALETTE.error };
const GRADE_TEXT: Record<DanceGrade, string> = { perfect: 'ИДЕАЛЬНО', good: 'ХОРОШО', miss: 'МИМО' };
const FLOATER_MS = 700;
const TILE_COLORS = [PALETTE.pink, PALETTE.violet, PALETTE.cyan, PALETTE.warn];

const BONES: ReadonlyArray<readonly [number, number]> = [
  [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
  [LM.LEFT_SHOULDER, LM.LEFT_ELBOW],
  [LM.LEFT_ELBOW, LM.LEFT_WRIST],
  [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW],
  [LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
  [LM.LEFT_SHOULDER, LM.LEFT_HIP],
  [LM.RIGHT_SHOULDER, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.LEFT_KNEE],
  [LM.LEFT_KNEE, LM.LEFT_ANKLE],
  [LM.RIGHT_HIP, LM.RIGHT_KNEE],
  [LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
];

interface Floater {
  player: number;
  grade: DanceGrade;
  points: number;
  born: number;
}

export interface DancerView {
  pose: Pose | null;
  /** Latest judged grade flash. */
  combo: number;
  /** Where the body is relative to the dancer's standing spot (squat, jump, step), in shoulder widths. */
  offset?: BodyOffset | null;
}

/** Arm end point for a pose angle (0° down, 90° out, 180° up) — mirrors dance.ts. */
function armEnd(shoulder: Point, deg: number, outward: -1 | 1, length: number): Point {
  const rad = (deg * Math.PI) / 180;
  return { x: shoulder.x + outward * Math.sin(rad) * length, y: shoulder.y + Math.cos(rad) * length };
}

/** How far a whole-body move moves the shoulders, in shoulder widths (the ghost on the dancer shows it). */
export function bodyShift(pose: DancePose): BodyOffset {
  switch (pose.body) {
    case 'squat':
      return { x: 0, y: 0.4 };
    case 'jump':
      return { x: 0, y: -0.32 };
    case 'step-left':
      return { x: -0.6, y: 0 };
    case 'step-right':
      return { x: 0.6, y: 0 };
    default:
      return { x: 0, y: 0 };
  }
}

/**
 * Leg lines of a figure whose shoulders are at (cx, cy) and whose feet stand on `groundY`:
 * straight when standing, knees out in a squat, tucked in a jump, wide in a step.
 */
function legPath(ctx: CanvasRenderingContext2D, pose: DancePose, cx: number, hipY: number, groundY: number, unit: number): void {
  const leg = (kx: number, ky: number, fx: number, fy: number) => {
    ctx.moveTo(cx, hipY);
    ctx.lineTo(kx, ky);
    ctx.lineTo(fx, fy);
  };
  switch (pose.body) {
    case 'squat':
      for (const s of [-1, 1]) leg(cx + s * unit * 0.6, (hipY + groundY) / 2 - unit * 0.05, cx + s * unit * 0.42, groundY);
      break;
    case 'jump':
      for (const s of [-1, 1]) leg(cx + s * unit * 0.32, hipY + unit * 0.6, cx + s * unit * 0.3, hipY + unit * 1.12);
      break;
    case 'step-left':
    case 'step-right': {
      const d = pose.body === 'step-left' ? -1 : 1;
      leg(cx + d * unit * 0.4, (hipY + groundY) / 2, cx + d * unit * 0.75, groundY);
      leg(cx - d * unit * 0.12, (hipY + groundY) / 2, cx - d * unit * 0.22, groundY);
      break;
    }
    default:
      leg(cx - unit * 0.17, (hipY + groundY) / 2, cx - unit * 0.35, groundY);
      leg(cx + unit * 0.17, (hipY + groundY) / 2, cx + unit * 0.35, groundY);
  }
}

/**
 * Stick figure of a dance move, `unit` = shoulder width. (cx, cy) is where the shoulders are
 * when standing; with `moveBody` the figure itself squats, jumps or steps (the ghost on the
 * dancer), otherwise it stays in place and the legs and a marker show the body move (cards).
 */
export function drawPoseFigure(
  ctx: CanvasRenderingContext2D,
  pose: DancePose,
  cx: number,
  cy: number,
  unit: number,
  color: string,
  dashed = false,
  moveBody = false,
): void {
  const groundY = cy + unit * 2.65;
  const shift = moveBody ? bodyShift(pose) : { x: 0, y: pose.body === 'squat' ? 0.3 : pose.body === 'jump' ? -0.2 : 0 };
  const sx = cx + shift.x * unit;
  const sy = cy + shift.y * unit;
  const ls = { x: sx - unit / 2, y: sy };
  const rs = { x: sx + unit / 2, y: sy };
  const hipY = sy + unit * (pose.body === 'squat' ? 1.2 : 1.35);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, unit * 0.14);
  if (dashed) ctx.setLineDash([unit * 0.18, unit * 0.14]);
  ctx.beginPath();
  ctx.moveTo(ls.x, ls.y);
  ctx.lineTo(rs.x, rs.y);
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx, hipY);
  legPath(ctx, pose, sx, hipY, groundY, unit);
  const l = armEnd(ls, pose.left, -1, unit * 1.45);
  const r = armEnd(rs, pose.right, 1, unit * 1.45);
  ctx.moveTo(ls.x, ls.y);
  ctx.lineTo(l.x, l.y);
  ctx.moveTo(rs.x, rs.y);
  ctx.lineTo(r.x, r.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(sx, sy - unit * 0.55, unit * 0.3, 0, Math.PI * 2);
  ctx.stroke();
  // Markers that read at card size: air under a jump, an arrow for a step, a floor line under a squat.
  ctx.lineWidth = Math.max(1.5, unit * 0.1);
  ctx.beginPath();
  if (pose.body === 'jump') {
    const fy = hipY + unit * 1.12 + unit * 0.35;
    ctx.moveTo(sx - unit * 0.55, fy);
    ctx.lineTo(sx - unit * 0.15, fy);
    ctx.moveTo(sx + unit * 0.15, fy);
    ctx.lineTo(sx + unit * 0.55, fy);
  } else if (pose.body === 'step-left' || pose.body === 'step-right') {
    const d = pose.body === 'step-left' ? -1 : 1;
    const ay = groundY + unit * 0.35;
    const tip = sx + d * unit * 1.25;
    ctx.moveTo(sx - d * unit * 0.2, ay);
    ctx.lineTo(tip, ay);
    ctx.moveTo(tip - d * unit * 0.32, ay - unit * 0.28);
    ctx.lineTo(tip, ay);
    ctx.lineTo(tip - d * unit * 0.32, ay + unit * 0.28);
  } else if (pose.body === 'squat') {
    ctx.moveTo(sx - unit * 0.3, sy - unit * 1.25);
    ctx.lineTo(sx, sy - unit * 1.0);
    ctx.lineTo(sx + unit * 0.3, sy - unit * 1.25);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Canvas renderer for the dance floor: neon floor pulsing on the beat,
 * incoming pose cards on a timeline, each dancer's live skeleton with the
 * target pose as a dashed ghost on top (error mode), and judgement pops.
 */
export class DanceRenderer {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly sizing: ReturnType<typeof observeCanvas>;
  private readonly floaters: Floater[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d');
    this.sizing = observeCanvas(canvas);
  }

  dispose(): void {
    this.sizing.dispose();
  }

  judged(player: number, grade: DanceGrade, points: number, now: number): void {
    this.floaters.push({ player, grade, points, born: now });
  }

  render(songTime: number, moves: readonly DanceMove[], current: DanceMove | null, dancers: readonly DancerView[], now: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { width: w, height: h, dpr } = this.sizing.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const beatPhase = songTime >= 0 ? (songTime % BEAT_MS) / BEAT_MS : 0;
    const pulse = songTime >= 0 ? (1 - beatPhase) ** 2 : 0;
    const bar = Math.max(0, Math.floor(songTime / (BEAT_MS * 4)));

    this.drawFloor(ctx, w, h, pulse, bar);
    const timelineH = Math.min(h * 0.24, 150);
    this.drawTimeline(ctx, w, timelineH, songTime, moves, pulse);

    const n = Math.max(1, dancers.length);
    const unit = Math.min((w / n) * 0.13, (h - timelineH) * 0.13);
    dancers.forEach((d, i) => {
      const cx = (w * (i + 0.5)) / n;
      const cy = timelineH + (h - timelineH) * 0.38;
      const color = PLAYER_COLORS[i] ?? PALETTE.cyan;
      // Spotlight
      const spot = ctx.createRadialGradient(cx, h * 0.9, 0, cx, h * 0.9, unit * 5);
      spot.addColorStop(0, rgba(color, 0.18 + pulse * 0.12));
      spot.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = spot;
      ctx.fillRect(cx - unit * 5, timelineH, unit * 10, h - timelineH);
      if (current && songTime >= current.at - DANCE_CONFIG.leadMs * 0.6) {
        // The ghost squats, jumps or steps where the dancer should go.
        drawPoseFigure(ctx, current.pose, cx, cy, unit, rgba(PALETTE.white, 0.35), true, true);
      }
      // The dancer moves with their body: down in a squat, up in a jump, sideways in a step.
      const off = d.offset;
      const dx = off ? clamp(off.x, -1.5, 1.5) * unit : 0;
      const dy = off ? clamp(off.y, -1.2, 1.2) * unit : 0;
      this.drawDancer(ctx, d.pose, cx + dx, cy + dy, unit, color);
      if (n > 1) {
        ctx.fillStyle = color;
        ctx.font = '800 16px Unbounded, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`P${i + 1}`, cx, h - 18);
      }
    });
    this.drawFloaters(ctx, w, n, timelineH + (h - timelineH) * 0.38 - unit * 1.6, now);
  }

  private drawFloor(ctx: CanvasRenderingContext2D, w: number, h: number, pulse: number, bar: number): void {
    const horizon = h * 0.52;
    const color = TILE_COLORS[bar % TILE_COLORS.length] ?? PALETTE.pink;
    ctx.save();
    ctx.strokeStyle = rgba(color, 0.25 + pulse * 0.45);
    ctx.lineWidth = 1.5;
    const vx = w / 2;
    for (let i = -8; i <= 8; i++) {
      ctx.beginPath();
      ctx.moveTo(vx + i * w * 0.02, horizon);
      ctx.lineTo(vx + i * w * 0.16, h);
      ctx.stroke();
    }
    for (let k = 0; k < 7; k++) {
      const t = (k / 6) ** 1.8;
      const y = horizon + (h - horizon) * t;
      ctx.globalAlpha = 0.3 + t * 0.7;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawTimeline(ctx: CanvasRenderingContext2D, w: number, th: number, songTime: number, moves: readonly DanceMove[], pulse: number): void {
    const hitX = Math.max(70, w * 0.16);
    const cy = th / 2 + 6;
    ctx.save();
    ctx.fillStyle = rgba(PALETTE.bg, 0.75);
    ctx.fillRect(0, 0, w, th);
    ctx.strokeStyle = rgba(PALETTE.white, 0.12);
    ctx.beginPath();
    ctx.moveTo(0, th);
    ctx.lineTo(w, th);
    ctx.stroke();
    // Beat ticks
    ctx.strokeStyle = rgba(PALETTE.white, 0.08);
    const first = Math.ceil((songTime - 1000) / BEAT_MS);
    for (let b = first; b * BEAT_MS < songTime + DANCE_CONFIG.leadMs; b++) {
      const x = hitX + ((b * BEAT_MS - songTime) / DANCE_CONFIG.leadMs) * (w - hitX);
      ctx.beginPath();
      ctx.moveTo(x, cy - 30);
      ctx.lineTo(x, cy + 30);
      ctx.stroke();
    }
    // Hit zone
    const size = th * 0.78;
    ctx.strokeStyle = rgba(PALETTE.pink, 0.6 + pulse * 0.4);
    ctx.lineWidth = 2 + pulse * 3;
    ctx.strokeRect(hitX - size / 2, cy - size / 2, size, size);
    for (let i = moves.length - 1; i >= 0; i--) {
      const m = moves[i];
      if (!m) continue;
      const dt = m.at - songTime;
      if (dt > DANCE_CONFIG.leadMs || dt < -400) continue;
      const x = hitX + (dt / DANCE_CONFIG.leadMs) * (w - hitX);
      const active = Math.abs(dt) < 400;
      ctx.globalAlpha = dt < 0 ? Math.max(0, 1 + dt / 400) : 1;
      ctx.fillStyle = rgba(active ? PALETTE.pink : PALETTE.violet, active ? 0.35 : 0.2);
      ctx.fillRect(x - size * 0.42, cy - size * 0.42, size * 0.84, size * 0.84);
      drawPoseFigure(ctx, m.pose, x, cy - size * 0.12, size * 0.17, active ? PALETTE.white : rgba(PALETTE.white, 0.8));
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private drawDancer(ctx: CanvasRenderingContext2D, pose: Pose | null, cx: number, cy: number, unit: number, color: string): void {
    if (!pose) {
      ctx.save();
      ctx.fillStyle = rgba(PALETTE.white, 0.5);
      ctx.font = '600 14px Manrope, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('встань в кадр', cx, cy);
      ctx.restore();
      return;
    }
    const ls = lm(pose, LM.LEFT_SHOULDER);
    const rs = lm(pose, LM.RIGHT_SHOULDER);
    const sc = midpoint(ls, rs);
    const sw = Math.max(1e-3, distance(ls, rs));
    const at = (i: number): Point => {
      const p = lm(pose, i);
      return { x: cx + ((p.x - sc.x) / sw) * unit, y: cy + ((p.y - sc.y) / sw) * unit };
    };
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = rgba(color, 0.25);
    ctx.lineWidth = unit * 0.45;
    this.bones(ctx, pose, at);
    ctx.strokeStyle = color;
    ctx.lineWidth = unit * 0.16;
    this.bones(ctx, pose, at);
    const nose = at(LM.NOSE);
    ctx.strokeStyle = PALETTE.white;
    ctx.beginPath();
    ctx.arc(nose.x, nose.y, unit * 0.3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private bones(ctx: CanvasRenderingContext2D, pose: Pose, at: (i: number) => Point): void {
    ctx.beginPath();
    for (const [a, b] of BONES) {
      if (lm(pose, a).v < 0.35 || lm(pose, b).v < 0.35) continue;
      const p = at(a);
      const q = at(b);
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
  }

  private drawFloaters(ctx: CanvasRenderingContext2D, w: number, n: number, y: number, now: number): void {
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      if (f && now - f.born > FLOATER_MS) this.floaters.splice(i, 1);
    }
    ctx.save();
    ctx.textAlign = 'center';
    for (const f of this.floaters) {
      const age = (now - f.born) / FLOATER_MS;
      const x = (w * (f.player + 0.5)) / n;
      ctx.globalAlpha = 1 - age * age;
      ctx.fillStyle = GRADE_COLOR[f.grade];
      ctx.font = `800 ${Math.round(26 + (1 - age) * 10)}px Unbounded, system-ui, sans-serif`;
      ctx.fillText(GRADE_TEXT[f.grade], x, y - age * 30);
      if (f.points > 0) {
        ctx.font = '700 14px "JetBrains Mono", ui-monospace, monospace';
        ctx.fillText(`+${f.points}`, x, y - age * 30 + 22);
      }
    }
    ctx.restore();
  }
}
