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
        <p className="t-label landing__eyebrow">MOTION//RUSH · камера вместо джойстика</p>
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
        <p className="t-lead landing__lead">Control the game with your body.</p>
        <p className="landing__body">
          Встань перед камерой в полный рост и двигайся по-настоящему: прыгай, шагай, приседай. Можно и сидя — игра сама
          подстроится после калибровки.
        </p>
        <p className="landing__modes">
          {GAME_MODES.length} режимов · мировой рейтинг · онлайн-дуэль 1 на 1
        </p>

        <motion.button
          type="button"
          className="btn btn--primary landing__cta"
          onClick={onStart}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.95 }}
          disabled={!cameraApi}
        >
          <span className="landing__cta-pulse" aria-hidden="true" />
          Start motion
          <Icon name="right" size={20} />
        </motion.button>
        <p className="t-micro landing__privacy">
          <Icon name="camera" size={14} /> Camera stays in your browser — видео никуда не отправляется
        </p>
        {!cameraApi && (
          <p className="landing__warning" role="alert">
            Этот браузер не даёт доступ к камере. Открой сайт в Chrome, Edge, Safari или Firefox по https.
          </p>
        )}
        <div className="landing__extra">
          {profile.bestScore > 0 && (
            <p className="landing__best">
              <span className="t-label">Твой рекорд</span>
              <span className="t-hud">{profile.bestScore.toLocaleString('ru-RU')}</span>
            </p>
          )}
          <button type="button" className="btn btn--ghost btn--small" onClick={onLeaderboard}>
            <Icon name="bolt" size={16} /> Рейтинг игроков
          </button>
        </div>
      </section>

      <section className="landing__visual" aria-label="Четыре движения игры">
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
      </section>
    </main>
  );
}
