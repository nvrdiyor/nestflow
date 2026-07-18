import { nest, type NestConfig, type Part } from '@nestflow/engine';

/**
 * Runs the nesting engine off the main thread so the UI never freezes, even for
 * `max`-strategy jobs that take several seconds. Parts and results are plain
 * data, so they cross the worker boundary via structured clone with no fuss.
 * Search progress is forwarded as {progress: 0..100} messages (deduplicated per
 * whole percent) so the UI can count up while the engine works.
 */
export interface NestRequest {
  parts: Part[];
  config: NestConfig;
}

const post = (msg: unknown): void => (self as unknown as Worker).postMessage(msg);

self.onmessage = (event: MessageEvent<NestRequest>) => {
  const { parts, config } = event.data;
  try {
    let lastPct = -1;
    const result = nest(parts, {
      ...config,
      onProgress: (fraction) => {
        const pct = Math.min(99, Math.round(fraction * 100));
        if (pct > lastPct) {
          lastPct = pct;
          post({ progress: pct });
        }
      },
    });
    // The engine echoes the config (incl. the onProgress function) back on the
    // result — functions can't cross the worker boundary, so strip it.
    const { onProgress: _drop, ...cleanConfig } = result.config as NestConfig & { onProgress?: unknown };
    post({ result: { ...result, config: cleanConfig } });
  } catch (err) {
    post({ error: err instanceof Error ? err.message : String(err) });
  }
};
