import { AnimatePresence, motion } from 'motion/react';
import { useEffect } from 'react';
import { achievementOf, type AchievementId } from '../features/achievements/achievements';

const SHOW_MS = 4800;

/** "Новое достижение": shown over any screen for a few seconds after a game unlocks one. */
export function AchievementToast({ fresh, onDone }: { fresh: { id: number; list: AchievementId[] } | null; onDone: () => void }) {
  useEffect(() => {
    if (!fresh) return;
    const timer = window.setTimeout(onDone, SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [fresh, onDone]);

  return (
    <AnimatePresence>
      {fresh && (
        <motion.div
          key={fresh.id}
          className="achv-toast"
          role="status"
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.25 }}
        >
          <span className="achv-toast__label">{fresh.list.length > 1 ? 'Новые достижения' : 'Новое достижение'}</span>
          {fresh.list.map((id) => {
            const a = achievementOf(id);
            return (
              <p key={id}>
                <span className="achv-toast__sq" aria-hidden="true" />
                <strong>{a.title}</strong> {a.text}
              </p>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
