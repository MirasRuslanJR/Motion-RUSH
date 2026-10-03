import { useEffect, useRef } from 'react';
import { observeCanvas } from '../../features/render/canvas';
import { BACKDROP, loadImage } from '../../features/render/sprites';
import { prefersReducedMotion } from '../../lib/env';

/** Where the sun sets: right of the menu column, like the scene behind a game's main menu. */
const VANISH_X = 0.66;
const HORIZON = 0.6;
const GRID_SPEED = 0.00022;

interface Star {
  x: number;
  y: number;
  r: number;
  phase: number;
}

/**
 * The main-menu backdrop: a neon synthwave night — twinkling stars, the game's
 * sunset and city skyline on the horizon, and a grid floor rolling towards the
 * viewer. Drawn on one canvas at a capped DPR; holds still for reduced motion.
 */
export function MenuScene({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const sizing = observeCanvas(canvas, undefined, 1.25);
    const still = prefersReducedMotion();
    let backdrop: HTMLImageElement | null = null;
    let raf = 0;
    let disposed = false;
    void loadImage(BACKDROP.url)
      .then((img) => {
        backdrop = img;
      })
      .catch(() => undefined);
    const stars: Star[] = Array.from({ length: 110 }, (_, i) => ({
      x: (Math.sin(i * 12.9898) * 43758.5453) % 1,
      y: Math.abs((Math.sin(i * 78.233) * 12345.678) % 1) * HORIZON * 0.92,
      r: 0.6 + (i % 5) * 0.32,
      phase: i * 1.7,
    }));

    const draw = (now: number) => {
      if (disposed) return;
      const { width: w, height: h, dpr } = sizing.size;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const horizon = h * HORIZON;
      const vx = w * VANISH_X;

      const sky = ctx.createLinearGradient(0, 0, 0, horizon);
      sky.addColorStop(0, '#06060d');
      sky.addColorStop(0.55, '#120e27');
      sky.addColorStop(1, '#3b1641');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, horizon);

      ctx.fillStyle = '#ffffff';
      for (const s of stars) {
        ctx.globalAlpha = still ? 0.5 : 0.3 + 0.4 * (0.5 + 0.5 * Math.sin(now / 1100 + s.phase));
        ctx.fillRect(Math.abs(s.x) * w, s.y * h, s.r, s.r);
      }
      ctx.globalAlpha = 1;

      // Sun glow, then the sunset and skyline art standing on the horizon.
      const glow = ctx.createRadialGradient(vx, horizon, 0, vx, horizon, Math.min(w, h) * 0.55);
      glow.addColorStop(0, 'rgba(255, 90, 209, 0.32)');
      glow.addColorStop(1, 'rgba(255, 90, 209, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, horizon);
      if (backdrop) {
        const bh = Math.min(h * 0.46, (w * 0.95) / (BACKDROP.width / BACKDROP.height));
        const bw = bh * (BACKDROP.width / BACKDROP.height);
        ctx.drawImage(backdrop, vx - bw / 2, horizon - bh, bw, bh);
      }

      const floor = ctx.createLinearGradient(0, horizon, 0, h);
      floor.addColorStop(0, '#1a0b24');
      floor.addColorStop(1, '#05050a');
      ctx.fillStyle = floor;
      ctx.fillRect(0, horizon, w, h - horizon);

      // Grid: rails converge on the sun, cross lines roll towards the viewer.
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(79, 220, 239, 0.5)';
      ctx.beginPath();
      for (let i = -14; i <= 14; i++) {
        ctx.moveTo(vx + i * w * 0.012, horizon);
        ctx.lineTo(vx + i * w * 0.2, h);
      }
      ctx.stroke();
      const offset = still ? 0 : (now * GRID_SPEED) % 1;
      ctx.strokeStyle = 'rgba(255, 90, 209, 0.55)';
      for (let k = 0; k < 12; k++) {
        const t = ((k + offset) / 12) ** 2.2;
        const y = horizon + (h - horizon) * t;
        ctx.globalAlpha = Math.min(1, 0.15 + t * 1.4);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // A bright horizon line.
      ctx.strokeStyle = 'rgba(255, 180, 140, 0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, horizon);
      ctx.lineTo(w, horizon);
      ctx.stroke();

      if (!still) raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    // The backdrop arrives after the first frame: draw once more when still.
    const redraw = still ? window.setTimeout(() => requestAnimationFrame(draw), 400) : 0;
    const onVisibility = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else if (!still) raf = requestAnimationFrame(draw);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(redraw);
      document.removeEventListener('visibilitychange', onVisibility);
      sizing.dispose();
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
