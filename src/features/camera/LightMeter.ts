const SAMPLE_W = 32;
const SAMPLE_H = 24;

/**
 * Estimates scene brightness from a tiny downscaled copy of the video frame.
 * Cheap enough to run once per second on the main thread.
 */
export class LightMeter {
  private readonly ctx: CanvasRenderingContext2D | null;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_W;
    canvas.height = SAMPLE_H;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
  }

  /** Mean luma 0-255, or null if the frame cannot be read. */
  sample(video: HTMLVideoElement): number | null {
    if (!this.ctx || video.readyState < 2) return null;
    try {
      this.ctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
      const { data } = this.ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += 0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);
      }
      return sum / (SAMPLE_W * SAMPLE_H);
    } catch {
      return null;
    }
  }
}
