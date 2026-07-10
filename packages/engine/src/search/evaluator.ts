import type { PartInstance } from '../model/prepared.js';
import { greedyPlace, type GreedyOptions, type GreedyResult } from '../placement/index.js';
import { decodeOrientation, type Chromosome } from './chromosome.js';
import { fitnessOf } from './fitness.js';

/** Shared context for evaluating chromosomes against a single nest job. */
export interface EvalContext {
  instances: PartInstance[];
  greedyOpts: GreedyOptions;
  sheetArea: number;
}

export interface Evaluation {
  result: GreedyResult;
  fitness: number;
}

/**
 * Decodes and evaluates a chromosome by running the deterministic greedy placer.
 * All evaluations share the {@link GreedyOptions.cache}, so NFPs computed for one
 * layout are reused by every other — the key to making population search
 * affordable.
 */
export function evaluate(ctx: EvalContext, chromo: Chromosome): Evaluation {
  const orientationOf = decodeOrientation(ctx.instances, chromo.rotation);
  const result = greedyPlace(ctx.instances, chromo.order, orientationOf, ctx.greedyOpts);
  return { result, fitness: fitnessOf(result, ctx.sheetArea) };
}
