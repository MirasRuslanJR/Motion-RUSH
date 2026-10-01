import { GAME_CONFIG } from '../../config/game.config';
import { clamp, lerp, midpoint, type Point } from '../../lib/math/geometry';
import type { MotionFrame } from '../engine/MotionEngine';
import type { GameEngine, GameEvent } from '../gameplay/GameEngine';
import { isPickup, OBSTACLE_REQUIREMENT, type CourseItem } from '../gameplay/types';
import { motionMeta } from '../gestures/types';
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
  // Landscape: the runner stands above the hint card at the bottom of the scene.
  return { w, h, horizonY: h * (portrait ? 0.24 : 0.27), groundY: h * (portrait ? 0.66 : 0.79), vx: w / 2, laneW };
}

const FLOATER_MS = 900;
const TRAIL_POINTS = 4; // head, both hands, hips
const TRAIL_CAPACITY = 12;
const TRACK_EDGES = [-1.5, -0.5, 0.5, 1.5] as const;
/** The online opponent runs slightly behind the player so both stay visible in one lane. */
const GHOST_Z = 0.9;

/** What the renderer needs to draw the online opponent. */
export interface OpponentGhost {
  name: string;
  lane: number;
  airborne: boolean;
  ducking: boolean;
}

/**
 * Canvas renderer for the runner scene. Reads game + motion state, owns only
 * cosmetic state (smoothing, particles, flashes). Never mutates the game.
 *
 * Two layers: a static background canvas (sky, stars, horizon) redrawn only on
 * resize, and a transparent dynamic canvas redrawn every frame — so the GPU does
 * not re-blit a full-screen image 60 times per second.
 */
export class GameRenderer {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly sizing: ReturnType<typeof observeCanvas>;
  private readonly backgroundSizing: ReturnType<typeof observeCanvas>;
  private readonly backgroundCtx: CanvasRenderingContext2D | null;
  private readonly particles = new ParticleSystem();
  private readonly itemFx = new Map<number, ItemFx>();
  private readonly floaters: Floater[] = [];
  private readonly fallbackPose: Pose = createPose();
  /** Ring buffer of screen positions: [point][sample] → x, y. */
  private readonly trail = new Float32Array(TRAIL_POINTS * TRAIL_CAPACITY * 2);
  private trailCursor = 0;
  private trailCount = 0;
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
  /** Soft glow passes (off on the lowest quality level). */
  private glow = true;
  private opponent: OpponentGhost | null = null;
  private readonly ghostPose: Pose = createPose();
  private ghostLane = 0;
  private ghostJump = 0;
  private ghostDuck = 0;
  private wasAirborne = false;
  private landedAt = Number.NEGATIVE_INFINITY;
  /** Action word drawn above the next obstacle (cached per obstacle). */
  private labelFor = -1;
  private label = '';

  constructor(canvas: HTMLCanvasElement, background: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d');
    this.sizing = observeCanvas(canvas);
    this.backgroundCtx = background.getContext('2d', { alpha: false });
    // Soft gradients and 1-px stars do not need retina resolution.
    this.backgroundSizing = observeCanvas(background, (size) => this.drawBackground(size), 1);
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  /** Latest known state of the online opponent (null = solo run). */
  setOpponent(opponent: OpponentGhost | null): void {
    this.opponent = opponent;
  }

  dispose(): void {
    this.sizing.dispose();
    this.backgroundSizing.dispose();
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
          sub: perfect ? 'ИДЕАЛЬНО' : 'ХОРОШО',
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
        this.floaters.push({ text: 'МИМО', sub: '', x: chest.x, y: chest.y - g.laneW * 0.9, born: now, color: PALETTE.error });
        break;
      case 'orb': {
        this.itemFx.set(event.item.id, { status: 'clear', at: now });
        const x = this.laneX(g, event.item.lane, 0);
        const y = this.groundY(g, 0) - g.laneW * 0.5;
        this.particles.burst(x, y, PALETTE.cyan, 14, g.laneW * 1.6);
        this.floaters.push({ text: `+${event.points}`, sub: '', x, y: y - g.laneW * 0.3, born: now, color: PALETTE.cyan });
        break;
      }
      case 'powerup': {
        this.itemFx.set(event.item.id, { status: 'clear', at: now });
        const x = this.laneX(g, event.item.lane, 0);
        const y = this.groundY(g, 0) - g.laneW * 0.5;
        const color = event.kind === 'SHIELD' ? PALETTE.success : PALETTE.warn;
        this.particles.burst(x, y, color, 26, g.laneW * 2);
        this.floaters.push({ text: event.kind === 'SHIELD' ? 'ЩИТ' : '×2', sub: event.kind === 'SHIELD' ? 'защита от промаха' : 'очки на 8 секунд', x, y: y - g.laneW * 0.3, born: now, color });
        break;
      }
      case 'shield-used':
        this.particles.burst(chest.x, chest.y, PALETTE.success, 24, g.laneW * 2.2);
        this.floaters.push({ text: 'ЩИТ', sub: 'жизнь сохранена', x: chest.x, y: chest.y - g.laneW * 0.9, born: now, color: PALETTE.success });
        break;
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

  render(game: GameEngine, frame: Readonly<MotionFrame>, dtMs: number, now: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const quality = frame.render;
    this.sizing.setMaxDpr(quality.maxDpr);
    this.glow = quality.glow;
    this.particles.intensity = (this.reducedMotion ? 0.35 : 1) * quality.particles;
    const { dpr } = this.sizing.size;
    const g = this.geometry();
    const running = game.phase === 'running';

    // Cosmetic smoothing (frame-rate independent).
    const k = (tau: number) => 1 - Math.exp(-dtMs / tau);
    this.laneVisual = lerp(this.laneVisual, game.lane, k(75));
    // A real arc over the jump's fixed airtime — up, hang, down — then a landing puff.
    const airT = (game.time - game.jumpStartedAt) / GAME_CONFIG.airtimeMs;
    const inAir = airT >= 0 && airT < 1;
    this.jumpVisual = inAir ? Math.sin(Math.PI * airT) : lerp(this.jumpVisual, 0, k(50));
    if (this.wasAirborne && !inAir) {
      this.landedAt = now;
      this.particles.burst(this.laneX(g, this.laneVisual, 0), this.groundY(g, 0), PALETTE.white, 10, g.laneW * 0.9, Math.PI * 0.9, -Math.PI / 2);
    }
    this.wasAirborne = inAir;
    this.duckVisual = lerp(this.duckVisual, game.ducking ? 1 : 0, k(60));
    const opp = this.opponent;
    if (opp) {
      // Network updates arrive ~5×/s: ease between them.
      this.ghostLane = lerp(this.ghostLane, opp.lane, k(140));
      this.ghostJump = lerp(this.ghostJump, opp.airborne ? 1 : 0, k(opp.airborne ? 80 : 140));
      this.ghostDuck = lerp(this.ghostDuck, opp.ducking ? 1 : 0, k(80));
    }
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
    this.drawTrack(ctx, g);
    this.drawLaneGuides(ctx, g, game, now);

    // The course is sorted by arrival, so walking it backwards goes far → near:
    // correct painter's order with no per-frame arrays or sorting.
    const course = game.course;
    const next = game.nextRequired;
    const nextId = next?.id ?? -1;
    if (next && next.id !== this.labelFor) {
      this.labelFor = next.id;
      this.label = isPickup(next.kind) ? '' : motionMeta(OBSTACLE_REQUIREMENT[next.kind], game.rules.scheme).title.toUpperCase();
    }
    for (let i = course.length - 1; i >= 0; i--) {
      const item = course[i];
      if (!item || !this.itemVisible(item)) continue;
      const z = this.itemZ(item, game.time);
      if (z > 0 && z <= Z_FAR) this.drawItem(ctx, g, item, z, now, item.id === nextId, item.id === nextId ? this.label : '');
    }
    if (opp) this.drawGhost(ctx, g, opp, game.time);
    this.drawRunner(ctx, g, game, frame, now, quality.trailLength);
    for (let i = course.length - 1; i >= 0; i--) {
      const item = course[i];
      if (!item || !this.itemVisible(item)) continue;
      const z = this.itemZ(item, game.time);
      if (z <= 0 && z > -0.9) this.drawItem(ctx, g, item, z, now, false, '');
    }

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

  /** Collected pickups disappear; everything else stays visible while in range. */
  private itemVisible(item: CourseItem): boolean {
    return !(isPickup(item.kind) && this.itemFx.has(item.id));
  }

  private drawBackground(size: CanvasSize): void {
    const ctx = this.backgroundCtx;
    if (!ctx) return;
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
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
  }

  private drawTrack(ctx: CanvasRenderingContext2D, g: Geometry): void {
    const zNear = -0.6;
    const edges = TRACK_EDGES;
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

  /**
   * Floor guides: a soft strip under the runner (where you are) and, for the
   * coming gate, its open lane pulsing (where to go) — green once you are there.
   */
  private drawLaneGuides(ctx: CanvasRenderingContext2D, g: Geometry, game: GameEngine, now: number): void {
    const strip = (lane: number, z0: number, z1: number, color: string, alpha: number) => {
      ctx.beginPath();
      ctx.moveTo(this.laneX(g, lane - 0.5, z0), this.groundY(g, z0));
      ctx.lineTo(this.laneX(g, lane + 0.5, z0), this.groundY(g, z0));
      ctx.lineTo(this.laneX(g, lane + 0.5, z1), this.groundY(g, z1));
      ctx.lineTo(this.laneX(g, lane - 0.5, z1), this.groundY(g, z1));
      ctx.closePath();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.fill();
    };
    ctx.save();
    strip(this.laneVisual, -0.6, 2.4, PALETTE.cyan, 0.09);
    const active = game.activeItem;
    if (active && game.phase === 'running' && (active.kind === 'GATE_LEFT' || active.kind === 'GATE_RIGHT' || active.kind === 'GATE_CENTER')) {
      const z = this.itemZ(active, game.time);
      if (z > 0) {
        const there = game.lane === active.lane;
        const pulse = 0.08 + 0.1 * (0.5 + 0.5 * Math.sin(now / 130));
        strip(active.lane, -0.6, Math.min(z, Z_FAR), there ? PALETTE.success : PALETTE.warn, there ? 0.16 : pulse);
      }
    }
    ctx.restore();
  }

  private drawItem(ctx: CanvasRenderingContext2D, g: Geometry, item: CourseItem, z: number, now: number, isNext: boolean, label: string): void {
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
          // Flat translucent fill (a per-wall gradient every frame is wasted work on weak GPUs).
          ctx.fillStyle = rgba(tint ?? PALETTE.violet, 0.34);
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
        if (this.glow) {
          ctx.fillStyle = rgba(PALETTE.cyan, 0.2);
          ctx.beginPath();
          ctx.arc(x, y, r * 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = rgba(PALETTE.white, 0.95);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'SHIELD':
      case 'BOOST': {
        const x = this.laneX(g, item.lane, z);
        const y = baseY - unit * 0.55;
        const r = unit * (0.17 + Math.sin(now / 200) * 0.015);
        const color = item.kind === 'SHIELD' ? PALETTE.success : PALETTE.warn;
        ctx.globalCompositeOperation = 'lighter';
        if (this.glow) {
          ctx.fillStyle = rgba(color, 0.18);
          ctx.beginPath();
          ctx.arc(x, y, r * 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = color;
        ctx.fillStyle = rgba(color, 0.25);
        ctx.lineWidth = Math.max(1.5, r * 0.22);
        ctx.lineJoin = 'round';
        ctx.beginPath();
        if (item.kind === 'SHIELD') {
          // Hexagon
          for (let i = 0; i < 6; i++) {
            const a = Math.PI / 6 + (i * Math.PI) / 3 + now / 900;
            ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
          }
        } else {
          // Lightning bolt
          ctx.moveTo(x + r * 0.25, y - r);
          ctx.lineTo(x - r * 0.45, y + r * 0.12);
          ctx.lineTo(x, y + r * 0.12);
          ctx.lineTo(x - r * 0.25, y + r);
          ctx.lineTo(x + r * 0.45, y - r * 0.12);
          ctx.lineTo(x, y - r * 0.12);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }
    }
    // The action word above the next obstacle — readable from a few metres away.
    if (label && !fx && z < Z_FAR * 0.8) {
      const size = clamp(unit * 0.2, 13, 34);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = alpha * clamp((Z_FAR * 0.8 - z) / 2, 0, 1);
      ctx.font = `800 ${Math.round(size)}px Unbounded, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(3, size * 0.22);
      ctx.strokeStyle = rgba(PALETTE.bg, 0.85);
      const ly = baseY - unit * 1.62;
      ctx.strokeText(label, this.laneX(g, 0, z), ly);
      ctx.fillStyle = PALETTE.white;
      ctx.fillText(label, this.laneX(g, 0, z), ly);
    }
    ctx.restore();
  }

  /** The online opponent: a translucent synthetic runner one step behind in its lane. */
  private drawGhost(ctx: CanvasRenderingContext2D, g: Geometry, opp: OpponentGhost, time: number): void {
    const s = project(GHOST_Z);
    const px = g.laneW * AVATAR_UNIT * s;
    const groundY = this.groundY(g, GHOST_Z);
    const jump = this.ghostJump * g.laneW * 0.62 * s;
    const legLen = lerp(LEG_STAND, LEG_DUCK, this.ghostDuck);
    const hip: Point = { x: this.laneX(g, this.ghostLane, GHOST_Z), y: groundY - legLen * px - jump };
    const arms = opp.airborne ? 1 : 0.05;
    const pose = buildSyntheticPose({ cx: 0, cy: 0, sw: 1, leftArm: arms, rightArm: arms }, this.ghostPose);
    const at = (i: number): Point => {
      const p = lm(pose, i);
      return { x: hip.x + p.x * px, y: hip.y + (p.y - TORSO) * px * (1 - this.ghostDuck * 0.15) };
    };
    const ls = at(LM.LEFT_SHOULDER);
    const rs = at(LM.RIGHT_SHOULDER);
    const nose = at(LM.NOSE);
    const w = Math.max(1.5, px * 0.14);
    const phase = (time / 300) * Math.PI * 2;

    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.lineCap = 'round';
    ctx.strokeStyle = PALETTE.pink;
    ctx.lineWidth = w;
    ctx.beginPath();
    for (const side of [-1, 1]) {
      const lift = Math.max(0, Math.sin(phase + (side > 0 ? Math.PI : 0))) * 0.5 * (1 - this.ghostJump) * (1 - this.ghostDuck) + this.ghostJump * 0.7;
      const hj: Point = { x: hip.x + side * 0.34 * px, y: hip.y };
      const foot: Point = { x: hip.x + side * (0.45 + this.ghostDuck * 0.35) * px, y: groundY - jump - lift * px };
      const knee: Point = { x: (hj.x + foot.x) / 2 + side * (0.25 + this.ghostDuck * 0.5) * px, y: (hj.y + foot.y) / 2 - lift * px * 0.35 };
      ctx.moveTo(hj.x, hj.y);
      ctx.lineTo(knee.x, knee.y);
      ctx.lineTo(foot.x, foot.y);
    }
    ctx.moveTo(ls.x, ls.y);
    ctx.lineTo(rs.x, rs.y);
    ctx.moveTo((ls.x + rs.x) / 2, (ls.y + rs.y) / 2);
    ctx.lineTo(hip.x, hip.y);
    for (const [s0, e0, w0] of [
      [LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST],
      [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
    ] as const) {
      const a = at(s0);
      const b = at(e0);
      const c = at(w0);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(nose.x, nose.y - px * 0.1, px * 0.32, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = PALETTE.pink;
    ctx.textAlign = 'center';
    ctx.font = '700 12px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillText(opp.name, nose.x, nose.y - px * 0.7);
    ctx.restore();
  }

  private drawBeamLine(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, thickness: number, color: string): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    if (this.glow) {
      ctx.strokeStyle = rgba(color, 0.25);
      ctx.lineWidth = thickness * 4;
      ctx.stroke();
    }
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
  private drawRunner(
    ctx: CanvasRenderingContext2D,
    g: Geometry,
    game: GameEngine,
    frame: Readonly<MotionFrame>,
    now: number,
    trailSamples: number,
  ): void {
    const px = g.laneW * AVATAR_UNIT;
    const groundY = this.groundY(g, 0);
    const jump = this.jumpVisual * g.laneW * 0.62;
    const legLen = lerp(LEG_STAND, LEG_DUCK, this.duckVisual);
    // A short squash on landing sells the weight of the jump.
    const squash = clamp(1 - (now - this.landedAt) / 180, 0, 1);
    const hip: Point = { x: this.laneX(g, this.laneVisual, 0), y: groundY - legLen * px - jump + squash * px * 0.3 };

    // Upper body source: live (display-smoothed) pose relative to a hip reference, else a synthetic figure.
    const pose = frame.displayPose;
    const baseline = frame.baseline;
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
    const bodyColor = flashMiss ? PALETTE.error : flashOk ? PALETTE.success : game.boosted ? PALETTE.warn : PALETTE.cyan;

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

    // Motion trail (head, both hands, hips) in a preallocated ring buffer.
    this.pushTrail(nose, lw, rw, hip);
    this.drawTrail(ctx, bodyColor, px * 0.18, trailSamples);

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

    const glow = this.glow;
    const bone = (a: Point, b: Point, color: string, width: number) => {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      if (glow) {
        ctx.strokeStyle = rgba(color, 0.22);
        ctx.lineWidth = width * 3;
        ctx.stroke();
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    };

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const w = Math.max(3, px * 0.2);
    for (const [hj, kn, ft] of legs) {
      bone(hj, kn, PALETTE.violet, w);
      bone(kn, ft, PALETTE.violet, w);
    }
    const lh: Point = { x: hip.x - 0.34 * px, y: hip.y };
    const rh: Point = { x: hip.x + 0.34 * px, y: hip.y };
    // Filled torso: reads as a body, not a wireframe.
    ctx.fillStyle = rgba(bodyColor, 0.18);
    ctx.beginPath();
    ctx.moveTo(ls.x, ls.y);
    ctx.lineTo(rs.x, rs.y);
    ctx.lineTo(rh.x, rh.y);
    ctx.lineTo(lh.x, lh.y);
    ctx.closePath();
    ctx.fill();
    bone(lh, rh, PALETTE.white, w);
    bone(ls, lh, PALETTE.white, w);
    bone(rs, rh, PALETTE.white, w);
    bone(ls, rs, PALETTE.white, w);
    bone(ls, le, bodyColor, w);
    bone(le, lw, bodyColor, w);
    bone(rs, re, bodyColor, w);
    bone(re, rw, bodyColor, w);
    ctx.beginPath();
    ctx.arc(nose.x, nose.y - px * 0.1, px * 0.34, 0, Math.PI * 2);
    ctx.fillStyle = rgba(bodyColor, 0.22);
    ctx.fill();
    ctx.strokeStyle = rgba(PALETTE.white, 0.95);
    ctx.lineWidth = w;
    ctx.stroke();
    ctx.fillStyle = rgba(bodyColor, 1);
    for (const p of [lw, rw]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, w * 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
    if (game.shield) {
      // Shield bubble around the runner.
      const c = this.avatarChest;
      const r = px * 2.6 + Math.sin(now / 240) * px * 0.08;
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(PALETTE.success, 0.55);
      ctx.lineWidth = Math.max(1.5, px * 0.08);
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, r * 0.8, r, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = rgba(PALETTE.success, 0.06);
      ctx.fill();
    }
    ctx.restore();
  }

  private pushTrail(...points: Point[]): void {
    const base = this.trailCursor * TRAIL_POINTS * 2;
    for (let i = 0; i < TRAIL_POINTS; i++) {
      const p = points[i];
      if (!p) continue;
      this.trail[base + i * 2] = p.x;
      this.trail[base + i * 2 + 1] = p.y;
    }
    this.trailCursor = (this.trailCursor + 1) % TRAIL_CAPACITY;
    this.trailCount = Math.min(this.trailCount + 1, TRAIL_CAPACITY);
  }

  private drawTrail(ctx: CanvasRenderingContext2D, color: string, width: number, samples: number): void {
    const count = Math.min(this.trailCount, samples);
    if (count < 2) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    const slot = (k: number) => ((this.trailCursor - count + k + TRAIL_CAPACITY * 2) % TRAIL_CAPACITY) * TRAIL_POINTS * 2;
    for (let i = 0; i < TRAIL_POINTS; i++) {
      for (let k = 1; k < count; k++) {
        const a = slot(k - 1) + i * 2;
        const b = slot(k) + i * 2;
        const t = k / count;
        ctx.globalAlpha = 0.35 * t;
        ctx.lineWidth = width * t;
        ctx.beginPath();
        ctx.moveTo(this.trail[a] ?? 0, this.trail[a + 1] ?? 0);
        ctx.lineTo(this.trail[b] ?? 0, this.trail[b + 1] ?? 0);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawFloaters(ctx: CanvasRenderingContext2D, now: number): void {
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      if (f && now - f.born >= FLOATER_MS) this.floaters.splice(i, 1);
    }
    if (this.floaters.length === 0) return;
    ctx.save();
    ctx.textAlign = 'center';
    // Two passes so each font string is parsed once per frame, not once per label.
    ctx.font = '800 22px Unbounded, system-ui, sans-serif';
    for (const f of this.floaters) {
      const age = (now - f.born) / FLOATER_MS;
      ctx.globalAlpha = 1 - age * age;
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - age * 40);
    }
    ctx.font = '600 11px "JetBrains Mono", ui-monospace, monospace';
    for (const f of this.floaters) {
      if (!f.sub) continue;
      const age = (now - f.born) / FLOATER_MS;
      ctx.globalAlpha = 1 - age * age;
      ctx.fillStyle = f.color;
      ctx.fillText(f.sub, f.x, f.y - age * 40 + 16);
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
