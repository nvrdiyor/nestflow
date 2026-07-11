import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: false,
    // In dev the API runs separately on :8787; production serves both from one
    // process, so the app always talks same-origin `/api`.
    proxy: { '/api': 'http://localhost:8787' },
  },
  worker: { format: 'es' },
  // Pre-bundle the engine's CommonJS geometry deps so both the main thread and
  // the Web Worker resolve them cleanly.
  optimizeDeps: { include: ['clipper-lib', 'earcut'] },
});
