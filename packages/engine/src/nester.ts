import type { NestConfig, NestResult, Part } from './types.js';
import { prepareInstances } from './model/prepared.js';
import { NfpCache } from './nfp/cache.js';
import type { GreedyOptions } from './placement/index.js';
import { runSearch } from './search/index.js';
import { computeMetrics } from './metrics/index.js';

const DEFAULT_SEED = 0x1234_5678;

function validate(parts: Part[], config: NestConfig): void {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new Error('nest: at least one part is required');
  }
  if (config.sheet.width <= 0 || config.sheet.height <= 0) {
    throw new Error('nest: sheet width and height must be positive');
  }
  const ids = new Set<string>();
  for (const part of parts) {
    if (!part.id) throw new Error('nest: every part needs an id');
    if (ids.has(part.id)) throw new Error(`nest: duplicate part id "${part.id}"`);
    ids.add(part.id);
    if (!part.contour || part.contour.outer.length < 3) {
      throw new Error(`nest: part "${part.id}" has an invalid outer contour`);
    }
    if ((part.quantity ?? 1) < 1) {
      throw new Error(`nest: part "${part.id}" has a non-positive quantity`);
    }
  }
}

/** Usable placement rectangle after applying the sheet's safe margin. */
export function usableBounds(config: NestConfig) {
  const margin = config.sheet.margin ?? 0;
  return {
    minX: margin,
    minY: margin,
    maxX: config.sheet.width - margin,
    maxY: config.sheet.height - margin,
  };
}

/**
 * Nests a set of parts onto sheets, minimising material use.
 *
 * This is the engine's primary entry point. It prepares part instances, runs the
 * configured search (fast / balanced / max) over placement order and rotation
 * using NFP-based collision-free placement, then computes utilization and cost
 * metrics for the best layout found.
 */
export function nest(parts: Part[], config: NestConfig): NestResult {
  validate(parts, config);
  const started = Date.now();

  const instances = prepareInstances(parts, config);
  const usable = usableBounds(config);
  const sheetArea = config.sheet.width * config.sheet.height;
  const cache = new NfpCache();

  const greedyOpts: GreedyOptions = {
    usable,
    sheetLimit: config.sheet.quantity ?? Number.POSITIVE_INFINITY,
    holeFilling: config.holeFilling ?? true,
    objective: 'bounding-box',
    cache,
  };

  const outcome = runSearch(instances, greedyOpts, {
    strategy: config.strategy ?? 'balanced',
    seed: config.seed ?? DEFAULT_SEED,
    sheetArea,
    ...(config.timeLimitMs !== undefined ? { timeLimitMs: config.timeLimitMs } : {}),
    ...(config.onProgress ? { onProgress: config.onProgress } : {}),
  });

  const metrics = computeMetrics(outcome.result, config);

  return {
    placements: outcome.result.placements,
    unplaced: outcome.result.unplaced,
    sheetsUsed: outcome.result.sheets.length,
    metrics,
    iterations: outcome.iterations,
    elapsedMs: Date.now() - started,
    config,
  };
}

/** A configured, reusable nester. Convenience wrapper around {@link nest}. */
export class Nester {
  constructor(private readonly config: NestConfig) {}

  nest(parts: Part[], overrides?: Partial<NestConfig>): NestResult {
    return nest(parts, { ...this.config, ...overrides });
  }
}
