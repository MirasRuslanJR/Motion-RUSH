import { clamp } from '../../lib/math/geometry';
import type { MotionFrame } from '../engine/MotionEngine';
import { BossFight, type BossAttack } from '../arcade/boss';
import { BODY_GROUP_JOINTS, FreezeGame } from '../arcade/freeze';
import { STARS, StarCatch, type Pop, type Star } from '../arcade/starCatch';
import type { ArcadeGame } from '../arcade/types';
import { angleDiff, armAngles, DANCE_CONFIG } from '../dance/dance';
import { LM, lm } from '../tracking/landmarks';
import { coverMapping, mapLen, mapX, mapY, observeCanvas, type ViewMapping } from './canvas';
import { PALETTE, rgba } from './palette';

const GOLD = '#ffd24d';
/** Where the boss's head is, in frame heights from the top. */
const BOSS_Y = 0.17;

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
    else if (game instanceof BossFight) this.drawBossFight(ctx, game, frame, width, height, now);
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

  // ── Boss fight ──────────────────────────────────────────────────────

  private drawBossFight(ctx: CanvasRenderingContext2D, game: BossFight, frame: Readonly<MotionFrame>, width: number, height: number, now: number): void {
    const aspect = frame.aspect || 4 / 3;
    const region = frame.baseline?.region ?? { x0: 0, x1: aspect };
    const span = region.x1 - region.x0;
    // The lanes are thirds of the play area, split where the step registers (±0.3 of the half-width).
    const edges = [region.x0, region.x0 + span * 0.35, region.x0 + span * 0.65, region.x1];
    const top = this.y(0.24);
    const bottom = this.y(1);
    ctx.save();
    ctx.setLineDash([8, 10]);
    ctx.strokeStyle = rgba(PALETTE.white, 0.16);
    ctx.lineWidth = 2;
    for (const e of [edges[1], edges[2]]) {
      const x = this.x(e ?? 0);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }
    ctx.restore();

    const a = game.attack;
    if (a && a.result === 'pending') this.drawAttack(ctx, a, game.time, frame, edges, top, bottom, width, now);
    this.drawBossHead(ctx, game, aspect, now);
    this.drawBossFlashes(ctx, game, frame, width, height);
  }

  private drawAttack(
    ctx: CanvasRenderingContext2D,
    a: BossAttack,
    t: number,
    frame: Readonly<MotionFrame>,
    edges: number[],
    top: number,
    bottom: number,
    width: number,
    now: number,
  ): void {
    const k = clamp((t - a.startAt) / Math.max(1, a.hitAt - a.startAt), 0, 1);
    const impact = t >= a.hitAt;
    const pulse = 0.5 + 0.5 * Math.sin(now / (impact ? 30 : 150 - 100 * k));
    ctx.save();
    if (a.kind === 'lane' || a.kind === 'sweep') {
      for (const lane of [-1, 0, 1] as const) {
        const x0 = this.x(edges[lane + 1] ?? 0);
        const x1 = this.x(edges[lane + 2] ?? 0);
        if (a.lanes.includes(lane)) {
          // The struck lane glows redder and faster as the strike charges, then flashes.
          const alpha = impact ? 0.7 : 0.1 + 0.4 * k * (0.6 + 0.4 * pulse);
          const g = ctx.createLinearGradient(0, top, 0, bottom);
          g.addColorStop(0, rgba(PALETTE.error, alpha * 0.2));
          g.addColorStop(1, rgba(PALETTE.error, alpha));
          ctx.fillStyle = g;
          ctx.fillRect(x0, top, x1 - x0, bottom - top);
          // The charge: a bar fills the lane's top edge.
          ctx.fillStyle = rgba(PALETTE.error, 0.95);
          ctx.fillRect(x0, top, (x1 - x0) * k, 5);
        } else {
          // A free lane: a calm green outline — where to go.
          ctx.strokeStyle = rgba(PALETTE.success, 0.35 + 0.35 * k);
          ctx.lineWidth = 3;
          ctx.setLineDash([12, 10]);
          ctx.strokeRect(x0 + 6, top + 6, x1 - x0 - 12, bottom - top - 12);
          ctx.setLineDash([]);
        }
      }
    } else if (a.kind === 'beam') {
      // At the height of the standing head (from the calibration), across the whole picture.
      const y = this.y((frame.baseline?.nose.y ?? 0.22) + 0.03);
      if (impact) {
        const h = Math.max(14, this.len(0.05));
        const g = ctx.createLinearGradient(0, y - h * 1.6, 0, y + h * 1.6);
        g.addColorStop(0, rgba(PALETTE.error, 0));
        g.addColorStop(0.5, rgba(PALETTE.error, 0.85));
        g.addColorStop(1, rgba(PALETTE.error, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, y - h * 1.6, width, h * 3.2);
        ctx.fillStyle = rgba(PALETTE.white, 0.9);
        ctx.fillRect(0, y - h * 0.15, width, h * 0.3);
      } else {
        ctx.strokeStyle = rgba(PALETTE.error, 0.3 + 0.6 * k * pulse);
        ctx.lineWidth = 3 + 4 * k;
        ctx.setLineDash([18, 12]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else {
      // A wave rolls along the floor: low while it comes, tall when it lands.
      const base = this.y(0.95);
      const amp = this.len(impact ? 0.09 : 0.015 + 0.05 * k);
      ctx.strokeStyle = rgba(impact ? PALETTE.warn : PALETTE.error, impact ? 0.95 : 0.4 + 0.5 * k);
      ctx.lineWidth = impact ? 8 : 4;
      ctx.beginPath();
      for (let x = 0; x <= width; x += 8) {
        const yy = base - Math.abs(Math.sin(x / 38 - now / 90)) * amp;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawBossHead(ctx: CanvasRenderingContext2D, game: BossFight, aspect: number, now: number): void {
    const stunned = game.phase === 'stunned';
    const counter = game.flashes.find((f) => f.kind === 'counter' && game.time - f.at < 450);
    const shake = counter ? Math.sin(now / 18) * this.len(0.012) * (1 - (game.time - counter.at) / 450) : 0;
    // Under the health bar, above the cue.
    const s = this.len(0.062);
    const cx = this.x(aspect / 2) + shake;
    const cy = this.y(BOSS_Y) + Math.sin(now / 420) * s * 0.06;
    const charge = game.attack && game.attack.result === 'pending' ? clamp((game.time - game.attack.startAt) / Math.max(1, game.attack.hitAt - game.attack.startAt), 0, 1) : 0;
    const color = stunned ? PALETTE.warn : '#ff5a6e';
    ctx.save();
    const aura = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 2.4);
    aura.addColorStop(0, rgba(color, 0.32 + charge * 0.3));
    aura.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(cx, cy, s * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Horns
    ctx.strokeStyle = rgba(color, 0.95);
    ctx.lineWidth = Math.max(3, s * 0.12);
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.7, cy - s * 0.55);
    ctx.lineTo(cx - s * 1.05, cy - s * 1.25);
    ctx.moveTo(cx + s * 0.7, cy - s * 0.55);
    ctx.lineTo(cx + s * 1.05, cy - s * 1.25);
    ctx.stroke();
    // Head
    ctx.fillStyle = counter ? rgba(PALETTE.white, 0.85) : '#1a0f22';
    ctx.lineWidth = Math.max(3, s * 0.09);
    ctx.beginPath();
    ctx.moveTo(cx - s, cy - s * 0.15);
    ctx.quadraticCurveTo(cx - s, cy - s, cx, cy - s);
    ctx.quadraticCurveTo(cx + s, cy - s, cx + s, cy - s * 0.15);
    ctx.lineTo(cx + s, cy + s * 0.5);
    ctx.quadraticCurveTo(cx + s, cy + s, cx + s * 0.5, cy + s);
    ctx.lineTo(cx - s * 0.5, cy + s);
    ctx.quadraticCurveTo(cx - s, cy + s, cx - s, cy + s * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Eyes: angry slits that glow as an attack charges; crosses when stunned.
    ctx.strokeStyle = stunned ? PALETTE.warn : rgba('#ffd0d6', 0.6 + 0.4 * charge);
    ctx.lineWidth = Math.max(3, s * 0.13);
    ctx.beginPath();
    if (stunned) {
      for (const ex of [-0.42, 0.42]) {
        ctx.moveTo(cx + (ex - 0.14) * s, cy - 0.16 * s);
        ctx.lineTo(cx + (ex + 0.14) * s, cy + 0.12 * s);
        ctx.moveTo(cx + (ex + 0.14) * s, cy - 0.16 * s);
        ctx.lineTo(cx + (ex - 0.14) * s, cy + 0.12 * s);
      }
    } else {
      ctx.moveTo(cx - s * 0.62, cy - s * 0.16);
      ctx.lineTo(cx - s * 0.2, cy + s * 0.05);
      ctx.moveTo(cx + s * 0.62, cy - s * 0.16);
      ctx.lineTo(cx + s * 0.2, cy + s * 0.05);
    }
    ctx.stroke();
    // Mouth
    ctx.strokeStyle = rgba(color, 0.9);
    ctx.lineWidth = Math.max(2, s * 0.08);
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.42, cy + s * 0.5);
    ctx.lineTo(cx + s * 0.42, cy + s * 0.5);
    for (const tx of [-0.2, 0, 0.2]) {
      ctx.moveTo(cx + tx * s, cy + s * 0.5);
      ctx.lineTo(cx + tx * s, cy + s * 0.68);
    }
    ctx.stroke();
    // Stunned: little stars circle the head.
    if (stunned) {
      ctx.fillStyle = PALETTE.warn;
      for (let i = 0; i < 3; i++) {
        const ang = now / 300 + (i * Math.PI * 2) / 3;
        const sx = cx + Math.cos(ang) * s * 1.35;
        const sy = cy - s * 1.1 + Math.sin(ang) * s * 0.3;
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(3, s * 0.1), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawBossFlashes(ctx: CanvasRenderingContext2D, game: BossFight, frame: Readonly<MotionFrame>, width: number, height: number): void {
    const nose = frame.displayPose ? lm(frame.displayPose, LM.NOSE) : null;
    const px = nose && nose.v > 0.4 ? this.x(nose.x) : width / 2;
    const py = nose && nose.v > 0.4 ? this.y(nose.y) - this.len(0.08) : height * 0.4;
    const bossX = this.x((frame.aspect || 4 / 3) / 2);
    const bossY = this.y(BOSS_Y);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of game.flashes) {
      const age = (game.time - f.at) / 1000;
      if (age < 0 || age > 1) continue;
      const fade = 1 - age;
      if (f.kind === 'hit') {
        if (age < 0.4) {
          ctx.fillStyle = rgba(PALETTE.error, 0.35 * (1 - age / 0.4));
          ctx.fillRect(0, 0, width, height);
        }
        ctx.fillStyle = rgba(PALETTE.error, fade);
        ctx.font = `800 ${Math.round(Math.max(22, this.len(0.06)))}px Unbounded, Manrope, system-ui, sans-serif`;
        ctx.fillText('−1 ♥', px, py - age * 40);
      } else if (f.kind === 'dodge') {
        ctx.fillStyle = rgba(PALETTE.cyan, fade);
        ctx.font = `800 ${Math.round(Math.max(18, this.len(0.045)))}px Unbounded, Manrope, system-ui, sans-serif`;
        ctx.fillText(`+${f.points}`, px, py - age * 50);
      } else if (f.kind === 'counter') {
        if (age < 0.25) {
          ctx.fillStyle = rgba(PALETTE.white, 0.5 * (1 - age / 0.25));
          ctx.fillRect(0, 0, width, height);
        }
        ctx.fillStyle = rgba(PALETTE.warn, fade);
        ctx.font = `800 ${Math.round(Math.max(30, this.len(0.1)))}px Unbounded, Manrope, system-ui, sans-serif`;
        ctx.fillText('БАМ!', bossX, bossY + this.len(0.16) - age * 30);
        ctx.font = `800 ${Math.round(Math.max(18, this.len(0.045)))}px Unbounded, Manrope, system-ui, sans-serif`;
        ctx.fillText(`+${f.points}`, bossX, bossY + this.len(0.24) - age * 30);
      } else {
        ctx.strokeStyle = rgba(PALETTE.warn, fade);
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(bossX, bossY, this.len(0.08) + age * this.len(0.25), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ── Freeze! ─────────────────────────────────────────────────────────

  private drawFreeze(ctx: CanvasRenderingContext2D, game: FreezeGame, frame: Readonly<MotionFrame>, width: number, height: number, now: number): void {
    const statue = game.lastStatue && game.time - game.lastStatue.at < 900 ? 1 - (game.time - game.lastStatue.at) / 900 : 0;
    const color =
      statue > 0 ? GOLD : game.light === 'red' ? PALETTE.error : game.light === 'yellow' ? PALETTE.warn : game.light === 'green' ? PALETTE.success : PALETTE.white;
    const strength = statue > 0 ? 0.6 + statue * 0.6 : game.light === 'red' ? 0.9 : game.light === 'yellow' ? 0.85 : game.light === 'green' ? 0.7 : 0.3;
    const pulse = game.light === 'red' ? 0.75 + 0.25 * Math.sin(now / 120) : game.light === 'yellow' ? 0.7 + 0.3 * Math.sin(now / 70) : 1;
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
    const pose = frame.displayPose;
    // The called figure as dashed target arms from the player's own shoulders — green when an arm is in place.
    const figure = game.figure;
    if (figure && pose && (game.light === 'yellow' || game.light === 'red')) {
      const ls = lm(pose, LM.LEFT_SHOULDER);
      const rs = lm(pose, LM.RIGHT_SHOULDER);
      if (Math.min(ls.v, rs.v) >= 0.5) {
        const reach = Math.hypot(rs.x - ls.x, rs.y - ls.y) * 1.45;
        const arms = armAngles(pose);
        const sides = [
          { s: ls, target: figure.pose.left, actual: arms.left, out: -1 },
          { s: rs, target: figure.pose.right, actual: arms.right, out: 1 },
        ] as const;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(4, this.len(0.012));
        for (const { s, target, actual, out } of sides) {
          const rad = (target * Math.PI) / 180;
          const ex = s.x + out * Math.sin(rad) * reach;
          const ey = s.y + Math.cos(rad) * reach;
          const ok = arms.visible && angleDiff(actual, target) <= DANCE_CONFIG.exactDeg + 8;
          const tone = ok ? PALETTE.success : game.light === 'yellow' ? PALETTE.warn : PALETTE.white;
          ctx.strokeStyle = rgba(tone, 0.9);
          ctx.setLineDash([this.len(0.02), this.len(0.016)]);
          ctx.beginPath();
          ctx.moveTo(this.x(s.x), this.y(s.y));
          ctx.lineTo(this.x(ex), this.y(ey));
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = rgba(tone, ok ? 0.9 : 0.5);
          ctx.beginPath();
          ctx.arc(this.x(ex), this.y(ey), Math.max(8, this.len(0.022)), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }
    // Caught: the part that moved lights up for a moment.
    const caught = game.lastCatch;
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
