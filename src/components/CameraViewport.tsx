import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import type { MotionEngine } from '../features/engine/MotionEngine';
import { motionMeta } from '../features/gestures/types';
import { CameraOverlayRenderer } from '../features/render/CameraOverlayRenderer';
import { useEngineFrame, useMotionUi } from '../hooks/useEngine';
import { Icon } from './Icon';
import './CameraViewport.css';

interface CameraViewportProps {
  engine: MotionEngine;
  variant?: 'stage' | 'panel' | 'pip';
  /** Show ghost pose, target lines and correction arrows. */
  guidance?: boolean;
  trail?: boolean;
  /** Show the corner HUD (tracking %, recognised gesture). */
  hud?: boolean;
  children?: ReactNode;
  className?: string;
}

/**
 * Mirrored camera "viewport": the single session <video> element is moved in
 * here, with a canvas overlay drawn every frame outside React.
 */
export function CameraViewport({
  engine,
  variant = 'stage',
  guidance = false,
  trail = true,
  hud = true,
  children,
  className,
}: CameraViewportProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CameraOverlayRenderer | null>(null);
  const confidenceRef = useRef<HTMLSpanElement>(null);
  const lastHudUpdate = useRef(0);
  const tracking = useMotionUi(engine, (s) => s.tracking);
  const lateral = useMotionUi(engine, (s) => s.lateral);
  const vertical = useMotionUi(engine, (s) => s.vertical);
  const modelReady = useMotionUi(engine, (s) => s.model === 'ready');
  const scheme = useMotionUi(engine, (s) => s.scheme);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const video = engine.video;
    host.prepend(video);
    engine.ensureVideoPlaying();
    return () => {
      // Moved, not removed: a detached <video> is paused by the browser and tracking would freeze.
      if (video.parentElement === host) engine.parkVideo();
    };
  }, [engine]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new CameraOverlayRenderer(canvas);
    rendererRef.current = renderer;
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEngineFrame(engine, (frame, _dt) => {
    rendererRef.current?.render(frame, frame.time, { guidance, trail });
    // Tracking confidence text: throttled DOM write, no React render.
    if (hud && frame.time - lastHudUpdate.current > 150 && confidenceRef.current) {
      lastHudUpdate.current = frame.time;
      const conf = frame.pose && frame.trackable ? Math.round(frame.quality.coreVisibility * 100) : 0;
      confidenceRef.current.textContent = `${conf}%`;
    }
  });

  const tracked = tracking !== 'NO_BODY' && tracking !== 'PARTIAL';
  const gestures = [lateral, vertical].filter((g) => g !== null);

  return (
    <div className={`viewport viewport--${variant} ${tracked ? 'is-tracked' : ''} ${className ?? ''}`}>
      <div ref={hostRef} className="viewport__media">
        <canvas ref={canvasRef} className="viewport__overlay" aria-hidden="true" />
      </div>
      <div className="viewport__scan" aria-hidden="true" />
      <div className="viewport__corners" aria-hidden="true" />
      {hud && (
        <>
          <div className="viewport__tag viewport__tag--tl">
            <span className={`live-dot ${tracked ? 'is-on' : ''}`} />
            {!modelReady ? 'Загружаем модель' : tracked ? 'Вижу тебя' : 'Ищу тебя в кадре'}
          </div>
          <div className="viewport__tag viewport__tag--tr" title="Уверенность трекинга">
            <Icon name="person" size={14} />
            <span ref={confidenceRef}>0%</span>
          </div>
          {gestures.length > 0 && (
            <div className="viewport__gestures" aria-live="polite">
              {gestures.map((g) => (
                <span key={g} className="gesture-badge">
                  {motionMeta(g, scheme).arrow && <Icon name={motionMeta(g, scheme).arrow ?? 'up'} size={14} />}
                  {motionMeta(g, scheme).title}
                </span>
              ))}
            </div>
          )}
        </>
      )}
      {children}
    </div>
  );
}
