export interface CanvasSize {
  width: number;
  height: number;
  dpr: number;
}

export interface ObservedCanvas {
  size: CanvasSize;
  /** Current DPR cap; call setMaxDpr when the quality level changes. */
  setMaxDpr: (maxDpr: number) => void;
  dispose: () => void;
}

/**
 * Keeps a canvas backing store in sync with its CSS size, with a capped DPR:
 * on a 2× laptop screen a full-DPR canvas is 4× the pixels to fill every frame,
 * which is exactly what integrated GPUs struggle with.
 * Resizing happens only on ResizeObserver callbacks / quality changes, never per frame.
 */
export function observeCanvas(
  canvas: HTMLCanvasElement,
  onResize?: (size: CanvasSize) => void,
  initialMaxDpr = 1.5,
): ObservedCanvas {
  const size: CanvasSize = { width: 0, height: 0, dpr: 1 };
  let maxDpr = initialMaxDpr;
  const apply = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    size.width = Math.max(1, rect.width);
    size.height = Math.max(1, rect.height);
    size.dpr = dpr;
    const w = Math.round(size.width * dpr);
    const h = Math.round(size.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    onResize?.(size);
  };
  apply();
  const observer = new ResizeObserver(apply);
  observer.observe(canvas);
  return {
    size,
    setMaxDpr: (next) => {
      if (next === maxDpr) return;
      maxDpr = next;
      apply();
    },
    dispose: () => observer.disconnect(),
  };
}

/** Maps mirrored frame units to canvas pixels for a video shown with object-fit: cover. */
export interface ViewMapping {
  scale: number;
  offsetX: number;
  offsetY: number;
  videoW: number;
  videoH: number;
}

export function coverMapping(containerW: number, containerH: number, videoW: number, videoH: number): ViewMapping {
  const vw = videoW || 640;
  const vh = videoH || 480;
  const scale = Math.max(containerW / vw, containerH / vh);
  return { scale, offsetX: (containerW - vw * scale) / 2, offsetY: (containerH - vh * scale) / 2, videoW: vw, videoH: vh };
}

/** Frame units: x ∈ [0, aspect], y ∈ [0, 1]  → canvas px. */
export function mapX(x: number, m: ViewMapping): number {
  return m.offsetX + x * m.videoH * m.scale;
}

export function mapY(y: number, m: ViewMapping): number {
  return m.offsetY + y * m.videoH * m.scale;
}

/** Length in frame units → px. */
export function mapLen(len: number, m: ViewMapping): number {
  return len * m.videoH * m.scale;
}
