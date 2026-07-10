import { nest, type NestConfig, type Part } from '@nestflow/engine';

/**
 * Runs the nesting engine off the main thread so the UI never freezes, even for
 * `max`-strategy jobs that take several seconds. Parts and results are plain
 * data, so they cross the worker boundary via structured clone with no fuss.
 */
export interface NestRequest {
  parts: Part[];
  config: NestConfig;
}

self.onmessage = (event: MessageEvent<NestRequest>) => {
  const { parts, config } = event.data;
  try {
    const result = nest(parts, config);
    (self as unknown as Worker).postMessage({ result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
