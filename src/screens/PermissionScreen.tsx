import { motion } from 'motion/react';
import { Icon } from '../components/Icon';
import './SetupScreens.css';

export function PermissionScreen() {
  return (
    <main className="screen center-screen">
      <div className="notice">
        <motion.div
          className="notice__icon"
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Icon name="camera" size={40} />
        </motion.div>
        <h1 className="t-headline">Разреши доступ к камере</h1>
        <p className="notice__text">
          Камера нужна, чтобы видеть твою позу. Распознавание работает прямо в браузере — видео не записывается и никуда
          не отправляется.
        </p>
        <p className="t-label notice__wait">
          <span className="spinner" aria-hidden="true" /> Ждём ответа браузера…
        </p>
      </div>
    </main>
  );
}
