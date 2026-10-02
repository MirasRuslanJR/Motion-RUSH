import { TRACKING_CONFIG } from '../../config/tracking.config';
import { CameraError, classifyCameraError } from './cameraErrors';

const FIRST_FRAME_TIMEOUT_MS = 6000;

function waitForFirstFrame(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2 && video.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new CameraError('unknown', 'Camera produced no frames'));
    }, FIRST_FRAME_TIMEOUT_MS);
    const onReady = () => {
      if (video.videoWidth === 0) return;
      cleanup();
      resolve();
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('resize', onReady);
    };
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('resize', onReady);
  });
}

/**
 * Owns the MediaStream and a single <video> element for the whole session.
 * The element is re-parented between screens instead of re-created, so the
 * stream never restarts when the UI changes.
 */
export class CameraSource {
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private endedHandler: (() => void) | null = null;
  /** What the stream was opened with — restored when wide mode ends. */
  private requested: MediaTrackConstraints = {};
  private wide = false;
  private switching: Promise<void> = Promise.resolve();

  constructor() {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('aria-label', 'Изображение с твоей камеры');
    video.className = 'camera-video';
    this.video = video;
  }

  get isLive(): boolean {
    return this.stream?.getVideoTracks().some((t) => t.readyState === 'live') ?? false;
  }

  onEnded(handler: () => void): void {
    this.endedHandler = handler;
  }

  async start(): Promise<void> {
    if (!window.isSecureContext) throw new CameraError('insecure');
    if (!navigator.mediaDevices?.getUserMedia) throw new CameraError('unsupported');

    const { idealWidth, idealHeight, idealFps } = TRACKING_CONFIG.camera;
    const preferred: MediaTrackConstraints = {
      facingMode: 'user',
      width: { ideal: idealWidth },
      height: { ideal: idealHeight },
      frameRate: { ideal: idealFps, max: 60 },
    };

    let stream: MediaStream;
    let requested = preferred;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: preferred });
    } catch (error) {
      // Some cameras reject the preferred constraints — retry with anything available.
      if (error instanceof Error && error.name === 'OverconstrainedError') {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
          requested = {};
        } catch (retryError) {
          throw new CameraError(classifyCameraError(retryError));
        }
      } else {
        throw new CameraError(classifyCameraError(error));
      }
    }

    this.stream = stream;
    this.requested = requested;
    for (const track of stream.getVideoTracks()) {
      track.addEventListener('ended', () => this.endedHandler?.());
    }
    this.video.srcObject = stream;
    try {
      await this.video.play();
    } catch {
      // Muted inline video may still refuse autoplay on some mobile browsers;
      // the viewport retries play() once it is attached to the page.
    }
    await waitForFirstFrame(this.video);
    if (this.wide) await this.applyWide(true);
  }

  /**
   * Two-player modes want the camera's whole width (16:9); leaving them
   * restores the original request, so the camera returns to the same mode and
   * a single-player calibration stays valid. Calls are applied in order.
   */
  setWide(wide: boolean): Promise<void> {
    if (wide === this.wide) return this.switching;
    this.wide = wide;
    this.switching = this.switching.then(() => this.applyWide(wide));
    return this.switching;
  }

  private async applyWide(wide: boolean): Promise<void> {
    const track = this.stream?.getVideoTracks()[0];
    if (!track || track.readyState !== 'live') return;
    const settings = track.getSettings();
    // Phones hold the camera upright: a landscape request would only crop the picture.
    if (wide && settings.width && settings.height && settings.width < settings.height) return;
    const { wide: size, idealFps } = TRACKING_CONFIG.camera;
    try {
      await track.applyConstraints(
        wide
          ? { width: { ideal: size.idealWidth }, height: { ideal: size.idealHeight }, aspectRatio: { ideal: 16 / 9 }, frameRate: { ideal: idealFps, max: 60 } }
          : this.requested,
      );
    } catch {
      // Keep whatever the camera gives: every screen adapts to the picture's shape.
    }
  }

  /** Resume playback after the element was moved in the DOM. */
  ensurePlaying(): void {
    if (this.stream && this.video.paused) void this.video.play().catch(() => undefined);
  }

  /**
   * A screen without a camera view must not stop tracking: browsers PAUSE a
   * video that is removed from the page. So the element is moved (not removed)
   * into a tiny invisible holder that stays in the document.
   */
  park(): void {
    let lot = document.getElementById('camera-parking');
    if (!lot) {
      lot = document.createElement('div');
      lot.id = 'camera-parking';
      lot.setAttribute('aria-hidden', 'true');
      lot.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:-1';
      document.body.appendChild(lot);
    }
    lot.appendChild(this.video);
    this.ensurePlaying();
  }

  stop(): void {
    this.endedHandler = null;
    this.wide = false;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
    }
    this.stream = null;
    this.video.srcObject = null;
    this.video.remove();
  }
}
