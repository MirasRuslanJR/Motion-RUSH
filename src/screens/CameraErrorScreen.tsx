import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { Icon } from '../components/Icon';
import { CAMERA_ERROR_COPY, type CameraErrorKind } from '../features/camera/cameraErrors';
import './SetupScreens.css';

interface CameraErrorScreenProps {
  kind: CameraErrorKind;
  onRetry: () => void;
}

export function CameraErrorScreen({ kind, onRetry }: CameraErrorScreenProps) {
  const [showFix, setShowFix] = useState(false);
  const copy = CAMERA_ERROR_COPY[kind];

  return (
    <main className="screen center-screen">
      <div className="notice notice--error" role="alert">
        <div className="notice__icon notice__icon--error">
          <Icon name="camera" size={40} />
          <span className="notice__badge">
            <Icon name="cross" size={14} />
          </span>
        </div>
        <p className="t-label notice__eyebrow">Camera not available</p>
        <h1 className="t-headline">{copy.title}</h1>
        <p className="notice__text">{copy.message}</p>
        <div className="notice__actions">
          <button type="button" className="btn btn--primary" onClick={onRetry}>
            Попробовать снова
          </button>
          <button type="button" className="btn btn--ghost" aria-expanded={showFix} onClick={() => setShowFix((v) => !v)}>
            Как исправить
          </button>
        </div>
        <AnimatePresence initial={false}>
          {showFix && (
            <motion.ol
              className="notice__fixes"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              {copy.fixes.map((fix) => (
                <li key={fix}>{fix}</li>
              ))}
            </motion.ol>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
