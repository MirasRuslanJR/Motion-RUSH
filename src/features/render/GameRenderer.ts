import { clamp, lerp, midpoint, type Point } from '../../lib/math/geometry';
import type { MotionFrame } from '../engine/MotionEngine';
import type { GameEngine, GameEvent } from '../gameplay/GameEngine';
import type { CourseItem } from '../gameplay/types';
import { createPose, LM, lm, type Pose } from '../tracking/landmarks';
import { buildSyntheticPose } from '../tracking/syntheticPose';
import { observeCanvas, type CanvasSize } from './canvas';
import { PALETTE, rgba } from './palette';
import { ParticleSystem } from './particles';

const Z_FAR = 12;
const FOCAL = 1.4;
/** Pixels per shoulder-width for the runner, relative to lane width. */
const AVATAR_UNIT = 0.25;
const LEG_STAND = 2.35;
const LEG_DUCK = 1.25;
const TORSO = 1.3;

interface ItemFx {
  status: 'clear' | 'miss';
  at: number;
}

interface Floater {
  text: string;
  sub: string;
  x: number;
  y: number;
  born: number;
  color: string;
}

interface Geometry {
  w: number;
  h: number;
  horizonY: number;
  groundY: number;
  vx: number;
  laneW: number;
}

function project(z: number): number {
  return FOCAL / (FOCAL + Math.max(z, -FOCAL * 0.6));
}

function layout(w: number, h: number): Geometry {
  const laneW = Math.min(w * 0.24, h * 0.34);
  // Portrait (phones): lift the runner above the HUD hint that sits at the bottom.
  const portrait = h > w * 0.9;
  return { w, h, horizonY: h * (portrait ? 0.24 : 0.3), groundY: h * (portrait ? 0.66 : 0.9), vx: w / 2, laneW };
}

/**
 * Canvas renderer for the runner scene. Reads game + motion state, owns only
 * cosmetic state (smoothing, particles, flashes). Never mutates the game.
 */
export class GameRenderer {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly sizing: ReturnType<typeof observeCanvas>;
  private background: HTMLCanvasElement | null = null;
  private readonly particles = new ParticleSystem();
  private readonly itemFx = new Map<number, ItemFx>();
  private readonly floaters: Floater[] = [];
  private readonly fallbackPose: Pose = createPose();
  private readonly trail: Point[][] = [[], [], [], []];
  private laneVisual = 0;
  private jumpVisual = 0;
  private duckVisual = 0;
  private stripeOffset = 0;
  private shakeUntil = 0;
  private missFlashUntil = 0;
  private successFlashUntil = 0;
  private comboRingAt = -1;
  private avatarChest: Point = { x: 0, y: 0 };
  private reducedMotion = false;

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d');
    this.sizing = observeCanvas(canvas, (size) => this.buildBackground(size));
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    this.particles.intensity = reduced ? 0.35 : 1;
  }

  dispose(): void {
    this.sizing.dispose();
    this.background = null;
  }

  private geometry(): Geometry {
    return layout(this.sizing.size.width, this.sizing.size.height);
  }

  private groundY(g: Geometry, z: number): number {
    return g.horizonY + (g.groundY - g.horizonY) * project(z);
  }

  private laneX(g: Geometry, lane: number, z: number): number {
    return g.vx + lane * g.laneW * project(z);
  }

  private itemZ(item: CourseItem, time: number): number {
    return ((item.arriveAt - time) / item.leadMs) * Z_FAR;
  }

  handleEvent(event: GameEvent, now: number): void {
    const g = this.geometry();
    const chest = this.avatarChest;
    switch (event.type) {
      case 'clear': {
        this.itemFx.set(event.item.id, { status: 'clear', at: now });
        this.successFlashUntil = now + 260;
        const perfect = event.quality === 'perfect';
        this.particles.burst(chest.x, chest.y, PALETTE.success, perfect ? 34 : 22, g.laneW * 2.4);
        if (perfect) this.particles.burst(chest.x, chest.y, PALETTE.white, 14, g.laneW * 3);
        this.floaters.push({
          text: `+${event.points}`,
          sub: perfect ? 'PERFECT' : 'GOOD',
          x: chest.x,
          y: chest.y - g.laneW * 0.9,
          born: now,
          color: perfect ? PALETTE.success : PALETTE.cyan,
        });
        break;
      }
      case 'miss':
        this.itemFx.set(event.item.id, { status: 'miss', at: now });
        this.missFlashUntil = now + 380;
        if (!this.reducedMotion) this.shakeUntil = now + 280;
        this.particles.burst(chest.x, chest.y, PALETTE.error, 20, g.laneW * 2, Math.PI * 1.2);
        this.floaters.push({ text: 'MISS', sub: '', x: chest.x, y: chest.y - g.laneW * 0.9, born: now, color: PALETTE.error });
        break;
      case 'orb': {
        const x = this.laneX(g, event.item.lane, 0);
        const y = this.groundY(g, 0) - g.laneW * 0.5;
        this.particles.burst(x, y, PALETTE.cyan, 14, g.laneW * 1.6);
        this.floaters.push({ text: `+${event.points}`, sub: '', x, y: y - g.laneW * 0.3, born: now, color: PALETTE.cyan });
        break;
      }
      case 'combo':
        this.comboRingAt = now;
        break;
      case 'jump':
        this.particles.burst(chest.x, this.groundY(g, 0), PALETTE.cyan, 12, g.laneW * 1.4, Math.PI * 0.8, -Math.PI / 2);
        break;
      default:
        break;
    }
  }

  render(game: GameEngine, frame: Readonly<MotionFrame> | null, dtMs: number, now: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { dpr } = this.sizing.size;
    const g = this.geometry();
    const running = game.phase === 'running';

    // Cosmetic smoothing (frame-rate independent).
    const k = (tau: number) => 1 - Math.exp(-dtMs / tau);
    this.laneVisual = lerp(this.laneVisual, game.lane, k(75));
    this.jumpVisual = lerp(this.jumpVisual, game.airborne ? 1 : 0, k(game.airborne ? 70 : 130));
    this.duckVisual = lerp(this.duckVisual, game.ducking ? 1 : 0, k(60));
    const lead = game.nextRequired?.leadMs ?? 2200;
    if (running) this.stripeOffset = (this.stripeOffset + (dtMs * Z_FAR) / lead) % 1.5;
    this.particles.update(dtMs);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, g.w, g.h);
    ctx.save();
    if (now < this.shakeUntil) {
      const a = ((this.shakeUntil - now) / 280) * 7;
      ctx.translate(Math.sin(now * 0.09) * a, Math.cos(now * 0.11) * a * 0.6);
    }
    if (this.background) ctx.drawImage(this.background, 0, 0, g.w, g.h);
    this.drawTrack(ctx, g);

    const visible = game.course
      .map((item) => ({ item, z: this.itemZ(item, game.time) }))
      .filter(({ item, z }) => z <= Z_FAR && z > -0.9 && !(item.kind === 'ORB' && this.itemFx.has(item.id)))
      .sort((a, b) => b.z - a.z);

    for (const { item, z } of visible) if (z > 0) this.drawItem(ctx, g, item, z, now, game.nextRequired?.id === item.id);
    this.drawRunner(ctx, g, game, frame, now);
    for (const { item, z } of visible) if (z <= 0) this.drawItem(ctx, g, item, z, now, false);

    this.particles.draw(ctx);
    this.drawFloaters(ctx, now);
    this.drawComboRing(ctx, g, now);
    ctx.restore();

    if (now < this.missFlashUntil) {
      const t = (this.missFlashUntil - now) / 380;
      const grad = ctx.createRadialGradient(g.w / 2, g.h / 2, g.h * 0.25, g.w / 2, g.h / 2, g.h * 0.85);
      grad.addColorStop(0, rgba(PALETTE.error, 0));
      grad.addColorStop(1, rgba(PALETTE.error, 0.35 * t));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, g.w, g.h);
    }
  }

  private buildBackground(size: CanvasSize): void {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(size.width * size.dpr);
    canvas.height = Math.round(size.height * size.dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(size.dpr, size.dpr);
    const w = size.width;
    const h = size.height;
    const horizon = layout(w, h).horizonY;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#04050a');
    sky.addColorStop(1, '#0d0a24');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, horizon);
    const floor = ctx.createLinearGradient(0, horizon, 0, h);
    floor.addColorStop(0, '#0b0a1d');
    floor.addColorStop(1, '#040509');
    ctx.fillStyle = floor;
    ctx.fillRect(0, horizon, w, h - horizon);
    const glow = ctx.createRadialGradient(w / 2, horizon, 0, w / 2, horizon, w * 0.55);
    glow.addColorStop(0, rgba(PALETTE.violet, 0.35));
    glow.addColorStop(0.4, rgba(PALETTE.cyan, 0.08));
    glow.addColorStop(1, rgba(PALETTE.violet, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = rgba(PALETTE.white, 0.15 + rand() * 0.45);
      ctx.fillRect(rand() * w, rand() * horizon * 0.95, 1.2, 1.2);
    }
    ctx.strokeStyle = rgba(PALETTE.cyan, 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    ctx.lineTo(w, horizon);
    ctx.stroke();
    this.background = canvas;
  }

  private drawTrack(ctx: CanvasRenderingContext2D, g: Geometry): void {
    const zNear = -0.6;
    const edges = [-1.5, -0.5, 0.5, 1.5];
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(this.laneX(g, -1.5, Z_FAR), this.groundY(g, Z_FAR));
    ctx.lineTo(this.laneX(g, 1.5, Z_FAR), this.groundY(g, Z_FAR));
    ctx.lineTo(this.laneX(g, 1.5, zNear), this.groundY(g, zNear));
    ctx.lineTo(this.laneX(g, -1.5, zNear), this.groundY(g, zNear));
    ctx.closePath();
    const floor = ctx.createLinearGradient(0, g.horizonY, 0, g.h);
    floor.addColorStop(0, rgba(PALETTE.violet, 0.05));
    floor.addColorStop(1, rgba(PALETTE.cyan, 0.1));
    ctx.fillStyle = floor;
    ctx.fill();

    ctx.globalCompositeOperation = 'lighter';
    for (const e of edges) {
      const outer = Math.abs(e) > 1;
      ctx.strokeStyle = rgba(outer ? PALETTE.violet : PALETTE.cyan, outer ? 0.7 : 0.28);
      ctx.lineWidth = outer ? 2 : 1.2;
      ctx.beginPath();
      ctx.moveTo(this.laneX(g, e, Z_FAR), this.groundY(g, Z_FAR));
      ctx.lineTo(this.laneX(g, e, zNear), this.groundY(g, zNear));
      ctx.stroke();
    }
    for (let z = Z_FAR - this.stripeOffset; z > zNear; z -= 1.5) {
      const s = project(z);
      ctx.strokeStyle = rgba(PALETTE.cyan, 0.05 + s * 0.2);
      ctx.lineWidth = 1;
      const y = this.groundY(g, z);
      ctx.beginPath();
      ctx.moveTo(this.laneX(g, -1.5, z), y);
      ctx.lineTo(this.laneX(g, 1.5, z), y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawItem(ctx: CanvasRenderingContext2D, g: Geometry, item: CourseItem, z: number, now: number, isNext: boolean): void {
    const s = project(z);
    const unit = g.laneW * s;
    const fx = this.itemFx.get(item.id);
    const fadeIn = clamp((Z_FAR - z) / 2.5, 0, 1);
    const fadeOut = z < 0 ? clamp(1 + z / 0.9, 0, 1) : 1;
    let alpha = fadeIn * fadeOut;
    let tint: string | null = null;
    if (fx) {
      const age = (now - fx.at) / 400;
      tint = fx.status === 'clear' ? PALETTE.success : PALETTE.error;
      if (fx.status === 'clear') alpha *= clamp(1 - age, 0, 1);
    }
    if (alpha <= 0.01) return;
    const baseY = this.groundY(g, z);

    ctx.save();
    ctx.globalAlpha = alpha;
    switch (item.kind) {
      case 'GATE_LEFT':
      case 'GATE_RIGHT':
      case 'GATE_CENTER': {
        for (const lane of [-1, 0, 1]) {
          const x0 = this.laneX(g, lane - 0.47, z);
          const x1 = this.laneX(g, lane + 0.47, z);
          const top = baseY - unit * 1.25;
          if (lane === item.lane) {
            ctx.strokeStyle = rgba(tint ?? PALETTE.cyan, 0.9);
            ctx.lineWidth = Math.max(1.5, unit * 0.03);
            ctx.strokeRect(x0, top, x1 - x0, baseY - top);
            this.drawChevron(ctx, (x0 + x1) / 2, top - unit * 0.28, unit * 0.22, item.lane === 0 ? 'down' : item.lane < 0 ? 'left' : 'right', tint ?? PALETTE.cyan, isNext);
            continue;
          }
          const wall = ctx.createLinearGradient(0, top, 0, baseY);
          wall.addColorStop(0, rgba(tint ?? PALETTE.violet, 0.55));
          wall.addColorStop(1, rgba(tint ?? PALETTE.violet, 0.18));
          ctx.fillStyle = wall;
          ctx.fillRect(x0, top, x1 - x0, baseY - top);
          ctx.strokeStyle = rgba(tint ?? PALETTE.violet, 1);
          ctx.lineWidth = Math.max(1.5, unit * 0.035);
          ctx.strokeRect(x0, top, x1 - x0, baseY - top);
          ctx.strokeStyle = rgba(PALETTE.white, 0.12);
          ctx.lineWidth = 1;
          for (let i = 1; i < 5; i++) {
            const y = top + ((baseY - top) * i) / 5;
            ctx.beginPath();
            ctx.moveTo(x0, y);
            ctx.lineTo(x1, y);
            ctx.stroke();
          }
        }
        break;
      }
      case 'HURDLE': {
        const x0 = this.laneX(g, -1.5, z);
        const x1 = this.laneX(g, 1.5, z);
        const y = baseY - unit * 0.3;
        this.drawBeamLine(ctx, x0, x1, y, unit * 0.07, tint ?? PALETTE.cyan);
        ctx.strokeStyle = rgba(tint ?? PALETTE.cyan, 0.7);
        ctx.lineWidth = Math.max(1, unit * 0.025);
        for (const x of [x0, x1]) {
          ctx.beginPath();
          ctx.moveTo(x, baseY);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
        for (const lane of [-1, 0, 1]) this.drawChevron(ctx, this.laneX(g, lane, z), y - unit * 0.35, unit * 0.16, 'up', tint ?? PALETTE.cyan, isNext);
        break;
      }
      case 'BEAM': {
        const x0 = this.laneX(g, -1.6, z);
        const x1 = this.laneX(g, 1.6, z);
        const y = baseY - unit * 0.98;
        ctx.strokeStyle = rgba(PALETTE.violet, 0.8);
        ctx.lineWidth = Math.max(1.5, unit * 0.04);
        for (const x of [x0, x1]) {
          ctx.beginPath();
          ctx.moveTo(x, baseY);
          ctx.lineTo(x, y - unit * 0.12);
          ctx.stroke();
        }
        this.drawBeamLine(ctx, x0, x1, y, unit * 0.05, tint ?? PALETTE.violet);
        for (const lane of [-1, 0, 1]) this.drawChevron(ctx, this.laneX(g, lane, z), y + unit * 0.3, unit * 0.16, 'down', tint ?? PALETTE.violet, isNext);
        break;
      }
      case 'ORB': {
        const x = this.laneX(g, item.lane, z);
        const y = baseY - unit * 0.5;
        const r = unit * (0.11 + Math.sin(now / 160) * 0.015);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = rgba(PALETTE.cyan, 0.2);
        ctx.beginPath();
        ctx.arc(x, y, r * 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgba(PALETTE.white, 0.95);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }
    ctx.restore();
  }

  private drawBeamLine(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, thickness: number, color: string): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(color, 0.25);
    ctx.lineWidth = thickness * 4;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.strokeStyle = rgba(color, 0.9);
    ctx.lineWidth = thickness * 1.4;
    ctx.stroke();
    ctx.strokeStyle = rgba(PALETTE.white, 0.9);
    ctx.lineWidth = Math.max(1, thickness * 0.45);
    ctx.stroke();
    ctx.restore();
  }

  private drawChevron(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    dir: 'up' | 'down' | 'left' | 'right',
    color: string,
    emphasize: boolean,
  ): void {
    const rot = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 }[dir];
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.strokeStyle = rgba(color, emphasize ? 1 : 0.7);
    ctx.lineWidth = Math.max(1.5, size * (emphasize ? 0.32 : 0.24));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-size, size * 0.55);
    ctx.lineTo(0, -size * 0.45);
    ctx.lineTo(size, size * 0.55);
    ctx.stroke();
    ctx.restore();
  }

  /** Runner = the player's real upper body (from the camera) on stylised running legs. */
  private drawRunner(ctx: CanvasRenderingContext2D, g: Geometry, game: GameEngine, frame: Readonly<MotionFrame> | null, now: number): void {
    const px = g.laneW * AVATAR_UNIT;
    const groundY = this.groundY(g, 0);
    const jump = this.jumpVisual * g.laneW * 0.62;
    const legLen = lerp(LEG_STAND, LEG_DUCK, this.duckVisual);
    const hip: Point = { x: this.laneX(g, this.laneVisual, 0), y: groundY - legLen * px - jump };

    // Upper body source: live pose relative to a hip reference, else a synthetic figure.
    const pose = frame?.pose;
    const baseline = frame?.baseline;
    let src: Pose;
    let hipRef: Point;
    let scale: number;
    if (pose && baseline && frame.trackable) {
      src = pose;
      scale = baseline.scale;
      const sc = midpoint(lm(pose, LM.LEFT_SHOULDER), lm(pose, LM.RIGHT_SHOULDER));
      const realHip = frame.features?.hipCenter ?? null;
      hipRef = realHip ?? { x: baseline.shoulderCenter.x, y: sc.y + TORSO * scale };
    } else {
      scale = 1;
      src = buildSyntheticPose(
        { cx: 0, cy: 0, sw: 1, leftArm: game.airborne ? 1 : 0.05, rightArm: game.airborne ? 1 : 0.05 },
        this.fallbackPose,
      );
      hipRef = { x: 0, y: TORSO };
    }
    const toAvatar = (p: Point): Point => ({
      x: hip.x + ((p.x - hipRef.x) / scale) * px,
      y: hip.y + ((p.y - hipRef.y) / scale) * px,
    });

    const flashOk = now < this.successFlashUntil;
    const flashMiss = now < this.missFlashUntil;
    const bodyColor = flashMiss ? PALETTE.error : flashOk ? PALETTE.success : PALETTE.cyan;

    // Shadow
    const shadowScale = 1 - this.jumpVisual * 0.45;
    ctx.save();
    ctx.fillStyle = rgba(PALETTE.cyan, 0.16 * shadowScale);
    ctx.beginPath();
    ctx.ellipse(hip.x, groundY, px * 1.3 * shadowScale, px * 0.28 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const ls = toAvatar(lm(src, LM.LEFT_SHOULDER));
    const rs = toAvatar(lm(src, LM.RIGHT_SHOULDER));
    const le = toAvatar(lm(src, LM.LEFT_ELBOW));
    const re = toAvatar(lm(src, LM.RIGHT_ELBOW));
    const lw = toAvatar(lm(src, LM.LEFT_WRIST));
    const rw = toAvatar(lm(src, LM.RIGHT_WRIST));
    const nose = toAvatar(lm(src, LM.NOSE));
    const sc = midpoint(ls, rs);
    this.avatarChest = { x: (sc.x + hip.x) / 2, y: (sc.y + hip.y) / 2 };

    // Motion trail: head, both hands, hips.
    const heads: Point[] = [nose, lw, rw, hip];
    heads.forEach((p, i) => {
      const list = this.trail[i];
      if (!list) return;
      list.push({ x: p.x, y: p.y });
      if (list.length > 12) list.shift();
    });
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const list of this.trail) {
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1];
        const b = list[i];
        if (!a || !b) continue;
        const t = i / list.length;
        ctx.strokeStyle = rgba(bodyColor, 0.35 * t);
        ctx.lineWidth = px * 0.18 * t;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    ctx.restore();

    // Legs (stylised run cycle; tucked in the air, bent when ducking).
    const phase = (game.time / 300) * Math.PI * 2;
    const runAmp = game.phase === 'running' && this.jumpVisual < 0.3 ? 1 - this.duckVisual : 0;
    const legs: Array<[Point, Point, Point]> = [-1, 1].map((side) => {
      const lift = Math.max(0, Math.sin(phase + (side > 0 ? Math.PI : 0))) * 0.55 * runAmp + this.jumpVisual * 0.7;
      const hipJ: Point = { x: hip.x + side * 0.34 * px, y: hip.y };
      const foot: Point = { x: hip.x + side * (0.45 + this.duckVisual * 0.35) * px, y: groundY - jump - lift * px };
      const knee: Point = {
        x: (hipJ.x + foot.x) / 2 + side * (0.25 + this.duckVisual * 0.5) * px,
        y: (hipJ.y + foot.y) / 2 - lift * px * 0.35,
      };
      return [hipJ, knee, foot];
    });

    const bone = (a: Point, b: Point, color: string, width: number) => {
      ctx.strokeStyle = rgba(color, 0.22);
      ctx.lineWidth = width * 3;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.strokeStyle = rgba(color, 1);
      ctx.lineWidth = width;
      ctx.stroke();
    };

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const w = Math.max(2, px * 0.16);
    for (const [hj, kn, ft] of legs) {
      bone(hj, kn, PALETTE.violet, w);
      bone(kn, ft, PALETTE.violet, w);
    }
    const lh: Point = { x: hip.x - 0.34 * px, y: hip.y };
    const rh: Point = { x: hip.x + 0.34 * px, y: hip.y };
    bone(lh, rh, PALETTE.white, w);
    bone(ls, lh, PALETTE.white, w);
    bone(rs, rh, PALETTE.white, w);
    bone(ls, rs, PALETTE.white, w);
    bone(ls, le, bodyColor, w);
    bone(le, lw, bodyColor, w);
    bone(rs, re, bodyColor, w);
    bone(re, rw, bodyColor, w);
    ctx.strokeStyle = rgba(PALETTE.white, 0.95);
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(nose.x, nose.y - px * 0.1, px * 0.34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = rgba(bodyColor, 1);
    for (const p of [lw, rw]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, w * 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawFloaters(ctx: CanvasRenderingContext2D, now: number): void {
    ctx.save();
    ctx.textAlign = 'center';
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      if (!f) continue;
      const age = (now - f.born) / 900;
      if (age >= 1) {
        this.floaters.splice(i, 1);
        continue;
      }
      const y = f.y - age * 40;
      ctx.globalAlpha = 1 - age * age;
      ctx.fillStyle = f.color;
      ctx.font = '800 22px Unbounded, system-ui, sans-serif';
      ctx.fillText(f.text, f.x, y);
      if (f.sub) {
        ctx.font = '600 11px "JetBrains Mono", ui-monospace, monospace';
        ctx.fillText(f.sub, f.x, y + 16);
      }
    }
    ctx.restore();
  }

  private drawComboRing(ctx: CanvasRenderingContext2D, g: Geometry, now: number): void {
    if (this.comboRingAt < 0) return;
    const age = (now - this.comboRingAt) / 600;
    if (age >= 1) return;
    ctx.save();
    ctx.strokeStyle = rgba(PALETTE.cyan, 1 - age);
    ctx.lineWidth = 3 * (1 - age) + 1;
    ctx.beginPath();
    ctx.arc(this.avatarChest.x, this.avatarChest.y, g.laneW * (0.3 + age * 1.2), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
