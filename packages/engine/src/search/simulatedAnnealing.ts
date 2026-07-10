import type { Rng } from '../rng.js';
import { evaluate, type EvalContext, type Evaluation } from './evaluator.js';
import type { SearchParams } from './strategy.js';
import { neighbor, type Chromosome } from './chromosome.js';

export interface SaOutcome {
  bestChromo: Chromosome;
  bestEval: Evaluation;
  iterations: number;
}

/**
 * Simulated-annealing refinement starting from a given chromosome (typically the
 * GA's best). Neighbours are single-move perturbations; worse moves are accepted
 * with probability exp(-ΔE / T) under a geometric cooling schedule, letting the
 * search escape local optima before settling. Always returns the best state
 * seen, which is never worse than the start.
 */
export function runSimulatedAnnealing(
  ctx: EvalContext,
  counts: number[],
  params: SearchParams,
  rng: Rng,
  start: Chromosome,
  startEval: Evaluation,
  deadline: number,
  now: () => number,
  onImprove?: (fitness: number) => void,
): SaOutcome {
  let iterations = 0;
  if (params.saIterations <= 0) {
    return { bestChromo: start, bestEval: startEval, iterations };
  }

  let current = start;
  let currentFit = startEval.fitness;
  let bestChromo = start;
  let bestEval = startEval;

  const cooling = Math.pow(params.saEndTemp / params.saStartTemp, 1 / params.saIterations);
  let temp = params.saStartTemp;

  for (let i = 0; i < params.saIterations; i++) {
    if (now() >= deadline) break;
    const candidate = neighbor(current, counts, rng);
    const candEval = evaluate(ctx, candidate);
    iterations++;
    const delta = candEval.fitness - currentFit;
    if (delta < 0 || rng.next() < Math.exp(-delta / Math.max(temp, 1e-6))) {
      current = candidate;
      currentFit = candEval.fitness;
      if (candEval.fitness < bestEval.fitness) {
        bestChromo = candidate;
        bestEval = candEval;
        onImprove?.(bestEval.fitness);
      }
    }
    temp *= cooling;
  }

  return { bestChromo, bestEval, iterations };
}
