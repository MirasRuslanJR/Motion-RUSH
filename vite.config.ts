/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base keeps the build portable: works on Vercel/Netlify root
// and on GitHub Pages sub-paths without changes.
export default defineConfig({
  base: './',
  plugins: [react()],
  // The pose worker is an ES module: MediaPipe then loads its WASM glue via import().
  worker: { format: 'es' },
  server: { host: true },
  preview: { host: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
