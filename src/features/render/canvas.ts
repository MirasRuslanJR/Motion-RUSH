export interface CanvasSize {
  width: number;
  height: number;
  dpr: number;
}

/**
 * Keeps a canvas backing store in sync with its CSS size (capped DPR for perf).
 * Resizing happens only on ResizeObserver callbacks, never per frame.
 */
export function observeCanvas(canvas: HTMLCanvasElement, onResize?: (size: CanvasSize) => void): {
  size: CanvasSize;
  dispose: () => void;
} {
  const size: CanvasSize = { width: 0, height: 0, dpr: 1 };
  const apply = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
  return { size, dispose: () => observer.disconnect() };
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
