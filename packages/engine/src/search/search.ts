import type { Strategy } from '../types.js';
import { Rng } from '../rng.js';
import type { PartInstance } from '../model/prepared.js';
import type { GreedyOptions, GreedyResult } from '../placement/index.js';
import { evaluate, type EvalContext } from './evaluator.js';
import { paramsForStrategy } from './strategy.js';
import { heuristicChromosome, orientationCounts, randomChromosome } from './chromosome.js';
import { runGeneticAlgorithm } from './geneticAlgorithm.js';
import { runSimulatedAnnealing } from './simulatedAnnealing.js';

export interface SearchOutcome {
  result: GreedyResult;
  fitness: number;
  iterations: number;
}

export interface SearchOptions {
  strategy: Strategy;
  seed: number;
  sheetArea: number;
  timeLimitMs?: number;
  onProgress?: (fraction: number, bestFitness: number) => void;
  /** Injectable clock (defaults to Date.now) for deterministic testing. */
  now?: () => number;
}

/**
 * Runs the full search pipeline for a nest job and returns the best layout.
 *
 * - `fast`: evaluates the heuristic seed plus a few random layouts.
 * - `balanced` / `max`: a genetic algorithm followed by a simulated-annealing
 *   polish, all under a shared time budget and NFP cache.
 */
export function runSearch(
  instances: PartInstance[],
  greedyOpts: GreedyOptions,
  options: SearchOptions,
): SearchOutcome {
  const { strategy, seed, sheetArea, timeLimitMs, onProgress } = options;
  const now = options.now ?? Date.now;
  const rng = new Rng(seed);
  const counts = orientationCounts(instances);
  const params = paramsForStrategy(strategy, timeLimitMs);
  const startTime = now();
  const deadline = startTime + params.timeLimitMs;
  const ctx: EvalContext = { instances, greedyOpts, sheetArea };

  let iterations = 0;
  const report = (fitness: number): void => {
    if (!onProgress) return;
    const frac = Math.min(1, (now() - startTime) / Math.max(1, params.timeLimitMs));
    onProgress(frac, fitness);
  };

  if (strategy === 'fast') {
    let best = evaluate(ctx, heuristicChromosome(instances));
    iterations++;
    report(best.fitness);
    for (let k = 0; k < params.populationSize - 1 && now() < deadline; k++) {
      const e = evaluate(ctx, randomChromosome(instances, counts, rng));
      iterations++;
      if (e.fitness < best.fitness) {
        best = e;
        report(best.fitness);
      }
    }
    return { result: best.result, fitness: best.fitness, iterations };
  }

  // Reserve a slice of the budget for the annealing polish: on huge jobs a
  // single GA generation can consume the whole budget and SA never runs.
  const gaDeadline = startTime + params.timeLimitMs * 0.65;
  const ga = runGeneticAlgorithm(ctx, counts, params, rng, Math.min(gaDeadline, deadline), now, report);
  iterations += ga.iterations;
  const sa = runSimulatedAnnealing(
    ctx,
    counts,
    params,
    rng,
    ga.best.chromo,
    ga.best.eval,
    deadline,
    now,
    report,
  );
  iterations += sa.iterations;

  report(sa.bestEval.fitness);
  return { result: sa.bestEval.result, fitness: sa.bestEval.fitness, iterations };
}
