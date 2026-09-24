import type { Bounds } from '../types.js';
import type { PartInstance } from '../model/prepared.js';
import type { GreedyResult } from '../placement/greedy.js';
import { fitnessOf } from '../search/fitness.js';
import { Rng } from '../rng.js';
import { buildRasterModel, type RasterModel } from './model.js';
import { rasterPlace } from './placer.js';

export interface RasterSearchOptions {
  usable: Bounds;
  clearance: number;
  holeFilling: boolean;
  sheetLimit: number;
  sheetArea: number;
  seed: number;
  timeLimitMs: number;
  /** false = evaluate the seed layouts only (deterministic, used by 'fast'). */
  localSearch?: boolean;
  /** Parallel lane: rotates the seed plan so lanes start from different layouts. */
  lane?: number;
  bandHeight?: number;
  onProgress?: (fraction: number, bestFitness: number) => void;
  now?: () => number;
}

export interface RasterSearchOutcome {
  result: GreedyResult;
  fitness: number;
  iterations: number;
}

interface Candidate {
  order: Int32Array;
  alpha: number;
  result: GreedyResult;
  fitness: number;
}

/**
 * Seed layouts, most promising first (big jobs may only afford a few): the
 * orders reproduce how people pack sign jobs — biggest first, rows of similar
 * height — and identical letters end up adjacent, so the placer's resume
 * cache turns long same-glyph runs into near-free placements.
 */
function seedPlan(model: RasterModel, instances: PartInstance[]): Array<{ order: Int32Array; alpha: number }> {
  const n = instances.length;
  const dims = instances.map((_, i) => {
    const opt = model.byInstance[i]!.options[0];
    const w = opt ? opt.prof.maxX - opt.prof.minX : 0;
    const h = opt ? opt.prof.maxY - opt.prof.minY : 0;
    return { w, h, area: instances[i]!.part.netArea, id: instances[i]!.part.id };
  });
  const by = (key: (i: number) => number): Int32Array => {
    const idx = Array.from({ length: n }, (_, i) => i);
    idx.sort((a, b) => key(b) - key(a) || (dims[a]!.id < dims[b]!.id ? -1 : dims[a]!.id > dims[b]!.id ? 1 : a - b));
    return Int32Array.from(idx);
  };
  const area = by((i) => dims[i]!.area);
  const height = by((i) => dims[i]!.h * 1e4 + dims[i]!.w);
  const maxDim = by((i) => Math.max(dims[i]!.w, dims[i]!.h) * 1e4 + dims[i]!.area / 1e4);
  const box = by((i) => dims[i]!.w * dims[i]!.h);
  const width = by((i) => dims[i]!.w * 1e4 + dims[i]!.h);
  return [
    { order: area, alpha: 0.5 },
    { order: area, alpha: 1 },
    { order: height, alpha: 0.5 },
    { order: maxDim, alpha: 0.5 },
    { order: box, alpha: 1 },
    { order: area, alpha: 0 },
    { order: height, alpha: 1 },
    { order: width, alpha: 0.5 },
    { order: maxDim, alpha: 1 },
    { order: box, alpha: 0.5 },
  ];
}

/**
 * One random perturbation of a placement order. `critical` holds the parts
 * that decide the score — those on the last sheet, or on a single sheet the
 * ones forming the far edge of the pack — and most moves pull one of them
 * earlier so it gets a chance at an interior gap.
 */
function perturb(order: Int32Array, rng: Rng, critical: number[]): Int32Array {
  const n = order.length;
  const out = order.slice();
  if (n < 2) return out;
  const move = rng.next();
  if (critical.length && move < 0.4) {
    const inst = critical[rng.int(critical.length)]!;
    const from = out.indexOf(inst);
    if (from > 0) {
      const to = rng.int(from);
      out.copyWithin(to + 1, to, from);
      out[to] = inst;
      return out;
    }
  }
  if (move < 0.65) {
    // Swap two positions — mostly near each other (similar-sized parts).
    const i = rng.int(n);
    const reach = rng.chance(0.7) ? Math.max(2, Math.floor(n / 12)) : n;
    let j = Math.min(n - 1, Math.max(0, i + rng.int(2 * reach + 1) - reach));
    if (j === i) j = (i + 1) % n;
    const t = out[i]!;
    out[i] = out[j]!;
    out[j] = t;
  } else if (move < 0.88) {
    // Move one item to another position.
    const from = rng.int(n);
    let to = rng.int(n);
    if (to === from) to = (to + 1) % n;
    const v = out[from]!;
    if (to < from) out.copyWithin(to + 1, to, from);
    else out.copyWithin(from, from + 1, to + 1);
    out[to] = v;
  } else {
    // Reverse a short segment.
    const len = 2 + rng.int(Math.min(12, n - 1));
    const i = rng.int(Math.max(1, n - len));
    let a = i;
    let b = Math.min(n - 1, i + len - 1);
    while (a < b) {
      const t = out[a]!;
      out[a] = out[b]!;
      out[b] = t;
      a++;
      b--;
    }
  }
  return out;
}

/**
 * Raster search: builds the band model once, evaluates heuristic seed layouts,
 * then spends the budget on a threshold-accepting local search over the
 * placement order. Every evaluation is a full constructive pass, so the best
 * layout is always a valid one. The search stops early once improvements dry
 * up — waiting out a long budget for nothing is not "quality".
 */
export function runRasterSearch(instances: PartInstance[], opts: RasterSearchOptions): RasterSearchOutcome {
  const now = opts.now ?? Date.now;
  const start = now();
  const budget = Math.max(1, opts.timeLimitMs);
  const deadline = start + budget;
  const rng = new Rng(opts.seed);
  let bestFit = Number.POSITIVE_INFINITY;
  const progress = (): void => {
    opts.onProgress?.(Math.min(1, (now() - start) / budget), bestFit);
  };

  const model = buildRasterModel(instances, {
    usable: opts.usable,
    clearance: opts.clearance,
    holeFilling: opts.holeFilling,
    ...(opts.bandHeight !== undefined ? { bandHeight: opts.bandHeight } : {}),
    onTick: progress,
  });

  const instanceIndex = new Map<string, number>();
  instances.forEach((inst, i) => instanceIndex.set(`${inst.part.id}#${inst.instance}`, i));

  let iterations = 0;
  // Held in an object: TS cannot track assignments made inside the closure.
  const top: { best: Candidate | null; at: number } = { best: null, at: start };
  const evaluate = (order: Int32Array, alpha: number, abortable: boolean): Candidate | null => {
    const result = rasterPlace(model, instances, order, {
      sheetLimit: opts.sheetLimit,
      alpha,
      onTick: progress,
      ...(abortable ? { abort: () => now() >= deadline } : {}),
    });
    if (!result) return null;
    iterations++;
    const cand: Candidate = { order, alpha, result, fitness: fitnessOf(result, opts.sheetArea) };
    if (!top.best || cand.fitness < top.best.fitness - 1e-9) {
      top.best = cand;
      top.at = now();
      bestFit = cand.fitness;
    }
    progress();
    return cand;
  };

  // Seeds — the very first pass always runs to completion (never abortable).
  // Seed-only mode ('fast') runs a fixed set with no clock checks, so it is
  // fully deterministic for a given input.
  const basePlan = seedPlan(model, instances);
  // Lanes start three seeds apart, so a few parallel workers cover the plan.
  const shift = ((opts.lane ?? 0) * 3) % basePlan.length;
  const plan = [...basePlan.slice(shift), ...basePlan.slice(0, shift)];
  if (opts.localSearch === false) {
    for (const s of plan.slice(0, 3)) evaluate(s.order, s.alpha, false);
  } else {
    for (const s of plan) {
      if (top.best && now() >= deadline) break;
      evaluate(s.order, s.alpha, top.best !== null);
    }
  }
  const champion = top.best;
  if (!champion) throw new Error('raster search produced no layout');

  // Local search over the order (threshold accepting on fitness).
  let current: Candidate = champion;
  let threshold = 0.03;
  let sinceImprove = 0;
  let stall = 0;
  const stallLimit = Math.max(400, instances.length * 4);
  const seedsDone = now();
  while (opts.localSearch !== false && now() < deadline && stall < stallLimit) {
    // Improvements dried up: no gain for max(8 s, 35% of the search so far).
    const t = now();
    if (t - Math.max(top.at, seedsDone) > Math.max(8000, 0.35 * (t - start))) break;
    const order = perturb(current.order, rng, criticalInstances(current, instanceIndex));
    const cand = evaluate(order, current.alpha, true);
    if (!cand) break;
    if (cand.fitness <= current.fitness + threshold * rng.next()) current = cand;
    if (cand === top.best) {
      sinceImprove = 0;
      stall = 0;
    } else {
      sinceImprove++;
      stall++;
    }
    threshold *= 0.97;
    if (sinceImprove > 60) {
      current = top.best ?? current;
      threshold = 0.015;
      sinceImprove = 0;
    }
  }

  const winner = top.best ?? champion;
  return { result: winner.result, fitness: winner.fitness, iterations };
}

/**
 * Instance indices that set the score: every part on the last sheet of a
 * multi-sheet layout, or on a single sheet the parts reaching into the far
 * 10% of the pack (they define its length).
 */
function criticalInstances(c: Candidate, instanceIndex: Map<string, number>): number[] {
  const sheets = c.result.sheets;
  const lastSheet = sheets.length - 1;
  const out: number[] = [];
  if (lastSheet > 0) {
    for (const item of sheets[lastSheet]!.items) {
      const i = instanceIndex.get(`${item.partId}#${item.instance}`);
      if (i !== undefined) out.push(i);
    }
    return out;
  }
  const only = sheets[0];
  if (!only?.bounds) return out;
  const { minY, maxY } = only.bounds;
  const edge = maxY - (maxY - minY) * 0.1;
  for (const item of only.items) {
    if (item.y + item.shape.bounds.maxY >= edge) {
      const i = instanceIndex.get(`${item.partId}#${item.instance}`);
      if (i !== undefined) out.push(i);
    }
  }
  return out;
}
