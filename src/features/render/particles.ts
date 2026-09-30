interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

const MAX_PARTICLES = 220;

/**
 * Pooled particle system for bursts (success / miss / orb).
 * Cosmetic only — uses its own RNG so game logic stays deterministic.
 */
export class ParticleSystem {
  private readonly pool: Particle[] = [];
  private active = 0;
  private seed = 1;
  intensity = 1;

  private random(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  burst(x: number, y: number, color: string, count: number, speed: number, spread = Math.PI * 2, direction = -Math.PI / 2): void {
    const n = Math.round(count * this.intensity);
    for (let i = 0; i < n && this.active < MAX_PARTICLES; i++) {
      const p = this.pool[this.active] ?? { x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, size: 0, color };
      this.pool[this.active] = p;
      const angle = direction + (this.random() - 0.5) * spread;
      const v = speed * (0.35 + this.random() * 0.65);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * v;
      p.vy = Math.sin(angle) * v;
      p.maxLife = 380 + this.random() * 420;
      p.life = p.maxLife;
      p.size = 1.5 + this.random() * 2.5;
      p.color = color;
      this.active++;
    }
  }

  update(dtMs: number): void {
    const dt = dtMs / 1000;
    for (let i = 0; i < this.active; ) {
      const p = this.pool[i];
      if (!p) break;
      p.life -= dtMs;
      if (p.life <= 0) {
        const last = this.pool[this.active - 1];
        if (last) {
          this.pool[i] = last;
          this.pool[this.active - 1] = p;
        }
        this.active--;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 420 * dt;
      p.vx *= 0.985;
      i++;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.active === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // Colour is set only when it changes (bursts are contiguous); fading uses
    // globalAlpha instead of building an rgba() string per particle per frame.
    let color = '';
    for (let i = 0; i < this.active; i++) {
      const p = this.pool[i];
      if (!p) continue;
      const t = p.life / p.maxLife;
      if (p.color !== color) {
        color = p.color;
        ctx.fillStyle = color;
      }
      ctx.globalAlpha = t;
      const r = p.size * (0.5 + t * 0.5);
      ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    }
    ctx.restore();
  }
}
