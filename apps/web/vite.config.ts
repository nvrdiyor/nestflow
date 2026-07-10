import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, strictPort: false },
  worker: { format: 'es' },
  // Pre-bundle the engine's CommonJS geometry deps so both the main thread and
  // the Web Worker resolve them cleanly.
  optimizeDeps: { include: ['clipper-lib', 'earcut'] },
});
