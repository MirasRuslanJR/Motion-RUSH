import { motion } from 'motion/react';
import { useState } from 'react';
import { DemoFigure } from '../components/DemoFigure';
import { Icon } from '../components/Icon';
import { GAME_MODES } from '../features/modes/modes';
import { BODY_MOTION_META, type ExpectedMotion } from '../features/gestures/types';
import { isCameraApiAvailable } from '../lib/env';
import type { Profile } from '../lib/storage';
import './LandingScreen.css';

type Move = Exclude<ExpectedMotion, 'CENTER'>;
const MOVES: Move[] = ['LEAN_LEFT', 'LEAN_RIGHT', 'JUMP', 'CROUCH'];

/** What a first-time player needs to know before pressing the button. */
const HOW_TO: { title: string; text: string }[] = [
  { title: 'Разреши камеру', text: 'Видео остаётся в твоём браузере — мы его не записываем.' },
  { title: 'Отойди на 2–3 шага', text: 'Чтобы камера видела тебя целиком. Можно и сидя — игра подстроится.' },
  { title: 'Двигайся', text: 'Перебегай, прыгай, приседай, танцуй. Ошибёшься — игра подскажет, как правильно.' },
];

const FEATURES = [`${GAME_MODES.length} режимов`, 'Танцпол с музыкой', 'Игра вдвоём', 'Онлайн-дуэль', 'Мировой рейтинг'];

interface LandingScreenProps {
  profile: Profile;
  onStart: () => void;
  onLeaderboard: () => void;
}

export function LandingScreen({ profile, onStart, onLeaderboard }: LandingScreenProps) {
  const [demoMove, setDemoMove] = useState<Move>('LEAN_LEFT');
  const cameraApi = isCameraApiAvailable();

  return (
    <main className="landing screen">
      <section className="landing__copy">
        <p className="landing__eyebrow">
          <span className="landing__eyebrow-dot" aria-hidden="true" />
          Игра, где контроллер — это ты
        </p>
        <h1 className="t-display landing__title">
          <motion.span initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            Move.
          </motion.span>
          <motion.span
            className="landing__title-accent"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            Don&rsquo;t click.
          </motion.span>
        </h1>
        <p className="landing__lead">
          Беги, прыгай и танцуй перед обычной веб-камерой. Никаких кнопок — только ты и твои движения.
        </p>

        <ol className="landing__how" aria-label="Как играть">
          {HOW_TO.map((step, i) => (
            <li key={step.title}>
              <span className="landing__how-num">{i + 1}</span>
              <span className="landing__how-title">{step.title}</span>
              <span className="landing__how-text">{step.text}</span>
            </li>
          ))}
        </ol>

        <div className="landing__actions">
          <motion.button
            type="button"
            className="btn btn--primary landing__cta"
            onClick={onStart}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.96 }}
            disabled={!cameraApi}
          >
            <span className="landing__cta-pulse" aria-hidden="true" />
            Начать игру
            <Icon name="right" size={20} />
          </motion.button>
          <button type="button" className="btn btn--ghost landing__secondary" onClick={onLeaderboard}>
            <Icon name="bolt" size={16} /> Рейтинг игроков
          </button>
        </div>
        <p className="landing__privacy">
          <Icon name="camera" size={14} /> Настройка займёт около 30 секунд · регистрация не нужна
        </p>
        {!cameraApi && (
          <p className="landing__warning" role="alert">
            Этот браузер не даёт доступ к камере. Открой сайт в Chrome, Edge, Safari или Firefox по https.
          </p>
        )}
        {profile.bestScore > 0 && (
          <p className="landing__best">
            С возвращением! Твой рекорд — <strong>{profile.bestScore.toLocaleString('ru-RU')}</strong>
          </p>
        )}
      </section>

      <section className="landing__visual" aria-label="Движения игры">
        <div className="landing__stage">
          <DemoFigure move="cycle" className="landing__figure" onMoveChange={setDemoMove} label="Фигура показывает движения игры" />
          <div className="landing__ring" aria-hidden="true" />
        </div>
        <ol className="landing__moves">
          {MOVES.map((m) => {
            const meta = BODY_MOTION_META[m];
            return (
              <li key={m} className={m === demoMove ? 'is-active' : ''}>
                <span className="landing__move-icon">{meta.arrow && <Icon name={meta.arrow} size={18} />}</span>
                <span className="landing__move-name">{meta.title}</span>
                <span className="landing__move-action">{meta.action}</span>
              </li>
            );
          })}
        </ol>
        <ul className="landing__features" aria-label="Что есть в игре">
          {FEATURES.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
