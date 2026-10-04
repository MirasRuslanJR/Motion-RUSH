import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { BOOT_LABELS, BOOT_SQUARES, bootDone, bootProgress, bootStep, type BootStatus } from '../app/bootProgress';
import { MODE_ART_URLS } from '../features/modes/modeArt';
import { BACKDROP, loadImage, preloadSprites } from '../features/render/sprites';
import { loadPoseBackend } from '../features/tracking/poseBackend';

/** Faces the UI uses (the Google Fonts link in index.html); the sample text pulls both the Cyrillic and the Latin subsets. */
const FONTS = [
  '600 1em Unbounded',
  '700 1em Unbounded',
  '800 1em Unbounded',
  '400 1em Manrope',
  '500 1em Manrope',
  '600 1em Manrope',
  '700 1em Manrope',
  '800 1em Manrope',
  '500 1em "JetBrains Mono"',
  '600 1em "JetBrains Mono"',
];
const SAMPLE = 'MOTION RUSH Играть Ёё 0123456789';

/** The first tip is also in index.html (the screen before the bundle arrives). */
const TIPS = [
  'Встань в 2–3 шагах от камеры — она должна видеть тебя целиком',
  'Свет спереди, а не из окна за спиной, — и распознавание точнее',
  'Распознавание идёт прямо в браузере — видео не уходит в сеть',
];
const TIP_MS = 3500;
/** Even from the cache the screen stays long enough not to flash. */
const MIN_MS = 900;
/** A slow connection: offer to open the menu while the model keeps loading. */
const SKIP_AFTER_MS = 8000;
const GIVE_UP_MS = 45000;

async function loadFonts(): Promise<void> {
  await Promise.all(FONTS.map((font) => document.fonts.load(font, SAMPLE).catch(() => [])));
  await document.fonts.ready;
}

function decodeImage(url: string): Promise<void> {
  return loadImage(url).then(
    (img) => img.decode().catch(() => undefined),
    () => undefined,
  );
}

/**
 * The loading screen over the app: it goes away once the fonts, every piece of art and the pose
 * model are ready, so nothing pops in on the menu and the first game starts without a wait.
 * Its styles live in index.html — the static page shows the same screen before the bundle loads.
 */
export function BootScreen({ onDone }: { onDone: () => void }) {
  const [status, setStatus] = useState<BootStatus>({ fonts: false, art: 0, model: false });
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let alive = true;
    const update = (patch: Partial<BootStatus>) => {
      if (alive) setStatus((s) => ({ ...s, ...patch }));
    };
    void loadFonts()
      .catch(() => undefined)
      .then(() => update({ fonts: true }));
    const images = [...MODE_ART_URLS, BACKDROP.url];
    const parts = images.length + 1;
    let loaded = 0;
    const onPart = () => update({ art: ++loaded / parts });
    for (const url of images) void decodeImage(url).then(onPart);
    void preloadSprites().then(onPart);
    void loadPoseBackend().then(
      () => update({ model: true }),
      () => update({ model: true }),
    );
    const started = performance.now();
    const timer = window.setInterval(() => setElapsed(performance.now() - started), 100);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const done = bootDone(status);
  const ready = done && elapsed >= MIN_MS;
  const finish = ready || elapsed >= GIVE_UP_MS;
  useEffect(() => {
    if (!finish) return;
    const timer = window.setTimeout(onDone, 350);
    return () => window.clearTimeout(timer);
  }, [finish, onDone]);

  const progress = done ? 1 : Math.min(bootProgress(status, elapsed), 0.99);
  const lit = Math.round(progress * BOOT_SQUARES);
  const pct = Math.floor(progress * 100);

  return (
    <motion.div className="boot" exit={{ opacity: 0 }} transition={{ duration: 0.4, ease: 'easeOut' }}>
      <div className="boot__logo">
        MOTION<span>//</span>RUSH
      </div>
      <p className="boot__tagline">Игра, где контроллер — это ты</p>
      <div className="boot__bar" role="progressbar" aria-label="Загрузка" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        {Array.from({ length: BOOT_SQUARES }, (_, i) => (
          <i key={i} className={i < lit ? 'is-on' : undefined} />
        ))}
      </div>
      <div className="boot__meta">
        <span aria-live="polite">{BOOT_LABELS[bootStep(status)]}</span>
        <span className="boot__pct">{pct}%</span>
      </div>
      <p className="boot__tip">{TIPS[Math.floor(elapsed / TIP_MS) % TIPS.length]}</p>
      {elapsed >= SKIP_AFTER_MS && !finish && (
        <button type="button" className="btn btn--ghost btn--small boot__skip" onClick={onDone}>
          Открыть меню
        </button>
      )}
    </motion.div>
  );
}
