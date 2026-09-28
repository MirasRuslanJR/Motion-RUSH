// Copies the MediaPipe Tasks Vision WASM runtime into public/ so the app
// can serve it from its own origin (no runtime dependency on a CDN).
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const target = join(root, 'public', 'mediapipe', 'wasm');

if (!existsSync(source)) {
  console.error('[mediapipe] WASM folder not found. Run `npm install` first.');
  process.exit(1);
}

// Module build → the pose Web Worker; classic SIMD / no-SIMD builds → main-thread fallback.
const files = readdirSync(source);
mkdirSync(target, { recursive: true });
for (const file of files) {
  cpSync(join(source, file), join(target, file));
}
console.log(`[mediapipe] copied ${files.length} runtime files -> public/mediapipe/wasm`);
