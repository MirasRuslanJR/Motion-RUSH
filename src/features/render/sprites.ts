import backdropUrl from '../../assets/game/backdrop.svg';
import boostUrl from '../../assets/game/boost.svg';
import heartUrl from '../../assets/game/heart.svg';
import hurdleUrl from '../../assets/game/hurdle.svg';
import magnetUrl from '../../assets/game/magnet.svg';
import orbUrl from '../../assets/game/orb.svg';
import pylonUrl from '../../assets/game/pylon.svg';
import shieldUrl from '../../assets/game/shield.svg';
import slowmoUrl from '../../assets/game/slowmo.svg';
import wallUrl from '../../assets/game/wall.svg';

/** Sprites of the runner scene; each one is an SVG in src/assets/game. */
export type SpriteName = 'wall' | 'hurdle' | 'pylon' | 'orb' | 'shield' | 'boost' | 'magnet' | 'slowmo' | 'heart';

interface SpriteSource {
  url: string;
  /** The SVG's viewBox size. */
  width: number;
  height: number;
}

const SPRITES: Record<SpriteName, SpriteSource> = {
  wall: { url: wallUrl, width: 300, height: 400 },
  hurdle: { url: hurdleUrl, width: 400, height: 160 },
  pylon: { url: pylonUrl, width: 120, height: 400 },
  orb: { url: orbUrl, width: 128, height: 128 },
  shield: { url: shieldUrl, width: 128, height: 128 },
  boost: { url: boostUrl, width: 128, height: 128 },
  magnet: { url: magnetUrl, width: 128, height: 128 },
  slowmo: { url: slowmoUrl, width: 128, height: 128 },
  heart: { url: heartUrl, width: 128, height: 128 },
};

/** Horizon art: its bottom edge is the horizon line, the sky above it stays transparent. */
export const BACKDROP: SpriteSource = { url: backdropUrl, width: 2400, height: 600 };

/** Where the pylon's emitter lens sits, from the top of the sprite (the beam is drawn through it). */
export const PYLON_LENS_Y = 46 / 400;

/**
 * Sprites are rasterised once, at 2× their viewBox: an SVG with glow filters
 * redrawn at a new scale every frame is far too slow for integrated graphics.
 */
const RASTER_SCALE = 2;
const ready = new Map<SpriteName, HTMLCanvasElement>();
let started = false;

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
}

/** Starts loading every sprite once. Until a sprite is ready the renderer draws its vector fallback. */
export function preloadSprites(): void {
  if (started || typeof document === 'undefined') return;
  started = true;
  for (const name of Object.keys(SPRITES) as SpriteName[]) {
    const source = SPRITES[name];
    void loadImage(source.url).then(
      (img) => {
        const canvas = document.createElement('canvas');
        canvas.width = source.width * RASTER_SCALE;
        canvas.height = source.height * RASTER_SCALE;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        ready.set(name, canvas);
      },
      () => {
        // Keep the vector fallback.
      },
    );
  }
}

/** A ready-to-draw sprite, or null while it is still loading. */
export function sprite(name: SpriteName): HTMLCanvasElement | null {
  return ready.get(name) ?? null;
}
