import type { MotionFrame } from '../engine/MotionEngine';
import { BODY_GROUP_JOINTS, FreezeGame } from '../arcade/freeze';
import { STARS, StarCatch, type Pop, type Star } from '../arcade/starCatch';
import type { ArcadeGame } from '../arcade/types';
import { lm } from '../tracking/landmarks';
import { coverMapping, mapLen, mapX, mapY, observeCanvas, type ViewMapping } from './canvas';
import { PALETTE, rgba } from './palette';

const GOLD = '#ffd24d';

/**
 * Draws the mini-games on top of the mirrored camera picture: stars, bombs
 * and the hands catching them; the light frame and "what moved" in Freeze!.
 * Uses the same object-fit: cover mapping as the skeleton overlay.
 */
export class ArcadeRenderer {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly sizing: ReturnType<typeof observeCanvas>;
  private mapping: ViewMapping = coverMapping(1, 1, 640, 480);

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d');
    this.sizing = observeCanvas(canvas);
  }

  dispose(): void {
    this.sizing.dispose();
  }

  render(game: ArcadeGame, frame: Readonly<MotionFrame>, now: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.sizing.setMaxDpr(frame.render.maxDpr);
    const { width, height, dpr } = this.sizing.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    this.mapping = coverMapping(width, height, frame.videoWidth || 640, frame.videoHeight || 480);
    if (game instanceof StarCatch) this.drawStars(ctx, game, now);
    else if (game instanceof FreezeGame) this.drawFreeze(ctx, game, frame, width, height, now);
  }

  private x(v: number): number {
    return mapX(v, this.mapping);
  }

  private y(v: number): number {
    return mapY(v, this.mapping);
  }

  private len(v: number): number {
    return mapLen(v, this.mapping);
  }

  // ── Star Catch ──────────────────────────────────────────────────────

  private drawStars(ctx: CanvasRenderingContext2D, game: StarCatch, now: number): void {
    for (const star of game.stars) this.drawStar(ctx, star, game.time, now);
    for (const pop of game.pops) this.drawPop(ctx, pop, game.time);
    // The hands: soft circles the size of their reach, so the player sees what touches.
    const handR = Math.max(10, this.len(STARS.handSW * game.sw));
    for (const hand of game.hands) {
      if (!hand) continue;
      const x = this.x(hand.x);
      const y = this.y(hand.y);
      const g = ctx.createRadialGradient(x, y, 0, x, y, handR);
      g.addColorStop(0, rgba(PALETTE.cyan, 0.55));
      g.addColorStop(1, rgba(PALETTE.cyan, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, handR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rgba(PALETTE.cyan, 0.9);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, handR * 0.45, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawStar(ctx: CanvasRenderingContext2D, star: Star, t: number, now: number): void {
    const x = this.x(star.x);
    const y = this.y(star.y);
    const r = Math.max(12, this.len(star.r));
    const life = Math.max(0, 1 - (t - star.bornAt) / star.ttl);
    const appear = Math.min(1, (t - star.bornAt) / 220);
    const pulse = 1 + 0.06 * Math.sin(now / 140 + star.id);
    const size = r * appear * pulse;
    const color = star.bomb ? PALETTE.error : GOLD;

    const glow = ctx.createRadialGradient(x, y, 0, x, y, size * 1.9);
    glow.addColorStop(0, rgba(color, 0.42));
    glow.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, size * 1.9, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(x, y);
    if (star.bomb) {
      // A spiky red ball with a cross: do not touch.
      ctx.fillStyle = '#3a0d0b';
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + now / 900;
        const rr = i % 2 === 0 ? size : size * 0.78;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      const c = size * 0.32;
      ctx.beginPath();
      ctx.moveTo(-c, -c);
      ctx.lineTo(c, c);
      ctx.moveTo(c, -c);
      ctx.lineTo(-c, c);
      ctx.stroke();
    } else {
      ctx.rotate(now / 2400 + star.id);
      ctx.fillStyle = color;
      ctx.strokeStyle = '#fff3c4';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 === 0 ? size : size * 0.45;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();

    // Time left: a ring that runs out.
    ctx.strokeStyle = rgba(star.bomb ? PALETTE.error : PALETTE.white, 0.75);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y, size * 1.3, -Math.PI / 2, -Math.PI / 2 + life * Math.PI * 2);
    ctx.stroke();
  }

  private drawPop(ctx: CanvasRenderingContext2D, pop: Pop, t: number): void {
    const age = (t - pop.at) / 900;
    if (age < 0 || age > 1) return;
    const x = this.x(pop.x);
    const y = this.y(pop.y);
    const r = Math.max(12, this.len(pop.r));
    const color = pop.kind === 'bomb' ? PALETTE.error : pop.kind === 'missed' ? PALETTE.white : pop.kind === 'quick' ? PALETTE.cyan : GOLD;
    ctx.save();
    ctx.globalAlpha = (1 - age) * (pop.kind === 'missed' ? 0.35 : 0.9);
    ctx.strokeStyle = color;
    ctx.lineWidth = 4 * (1 - age) + 1;
    ctx.beginPath();
    ctx.arc(x, y, r * (1 + age * 1.6), 0, Math.PI * 2);
    ctx.stroke();
    if (pop.kind !== 'missed') {
      ctx.fillStyle = color;
      ctx.font = `800 ${Math.round(Math.max(18, r * 0.8))}px Unbounded, Manrope, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const text = pop.kind === 'bomb' ? '−1 ♥' : `+${pop.points}`;
      ctx.fillText(text, x, y - r * (0.4 + age * 1.4));
    }
    ctx.restore();
  }

  // ── Freeze! ─────────────────────────────────────────────────────────

  private drawFreeze(ctx: CanvasRenderingContext2D, game: FreezeGame, frame: Readonly<MotionFrame>, width: number, height: number, now: number): void {
    const color = game.light === 'red' ? PALETTE.error : game.light === 'green' ? PALETTE.success : PALETTE.white;
    const strength = game.light === 'red' ? 0.9 : game.light === 'green' ? 0.7 : 0.3;
    const pulse = game.light === 'red' ? 0.75 + 0.25 * Math.sin(now / 120) : 1;
    // The light as a glowing frame around the picture.
    const edge = Math.min(width, height) * 0.09;
    const sides: [number, number, number, number, number, number, number, number][] = [
      [0, 0, width, edge, 0, 0, 0, edge],
      [0, height - edge, width, edge, 0, height, 0, height - edge],
      [0, 0, edge, height, 0, 0, edge, 0],
      [width - edge, 0, edge, height, width, 0, width - edge, 0],
    ];
    for (const [x, y, w, h, x0, y0, x1, y1] of sides) {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, rgba(color, 0.55 * strength * pulse));
      g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
    }
    // Caught: the part that moved lights up for a moment.
    const caught = game.lastCatch;
    const pose = frame.displayPose;
    if (caught && pose && game.time - caught.at < 1600) {
      const fade = 1 - (game.time - caught.at) / 1600;
      ctx.strokeStyle = rgba(PALETTE.error, 0.95 * fade);
      ctx.fillStyle = rgba(PALETTE.error, 0.25 * fade);
      ctx.lineWidth = 3;
      for (const i of BODY_GROUP_JOINTS[caught.group]) {
        const p = lm(pose, i);
        if (p.v < 0.5) continue;
        const r = Math.max(14, this.len(0.04));
        ctx.beginPath();
        ctx.arc(this.x(p.x), this.y(p.y), r * (1 + (1 - fade) * 0.6), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
}
