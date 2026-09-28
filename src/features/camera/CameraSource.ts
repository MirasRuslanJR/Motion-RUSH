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
    const preferred: MediaStreamConstraints = {
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: idealWidth },
        height: { ideal: idealHeight },
        frameRate: { ideal: idealFps, max: 60 },
      },
    };

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(preferred);
    } catch (error) {
      // Some cameras reject the preferred constraints — retry with anything available.
      if (error instanceof Error && error.name === 'OverconstrainedError') {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
        } catch (retryError) {
          throw new CameraError(classifyCameraError(retryError));
        }
      } else {
        throw new CameraError(classifyCameraError(error));
      }
    }

    this.stream = stream;
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
  }

  /** Resume playback after the element was moved in the DOM. */
  ensurePlaying(): void {
    if (this.stream && this.video.paused) void this.video.play().catch(() => undefined);
  }

  stop(): void {
    this.endedHandler = null;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
    }
    this.stream = null;
    this.video.srcObject = null;
    this.video.remove();
  }
}
