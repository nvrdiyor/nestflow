import type { Strategy } from '../types.js';

/** Tunable parameters that control search breadth, depth, and time budget. */
export interface SearchParams {
  populationSize: number;
  generations: number;
  eliteCount: number;
  tournamentSize: number;
  swapRate: number;
  rotRate: number;
  saIterations: number;
  saStartTemp: number;
  saEndTemp: number;
  timeLimitMs: number;
}

/**
 * Presets mapping the three user-facing modes to concrete search parameters:
 *
 * - `fast`     — a handful of greedy evaluations; near-instant, no metaheuristic.
 * - `balanced` — a modest genetic algorithm plus a simulated-annealing polish.
 * - `max`      — a large, long-running GA + SA for maximum material savings.
 *
 * A caller-supplied `timeLimitMs` always overrides the preset budget.
 */
export function paramsForStrategy(strategy: Strategy, timeLimitMs?: number): SearchParams {
  let params: SearchParams;
  switch (strategy) {
    case 'fast':
      params = {
        populationSize: 6,
        generations: 3,
        eliteCount: 2,
        tournamentSize: 2,
        swapRate: 0.7,
        rotRate: 0.4,
        saIterations: 0,
        saStartTemp: 1000,
        saEndTemp: 1,
        timeLimitMs: 1500,
      };
      break;
    case 'max':
      params = {
        populationSize: 30,
        generations: 60,
        eliteCount: 4,
        tournamentSize: 4,
        swapRate: 0.85,
        rotRate: 0.6,
        saIterations: 1500,
        saStartTemp: 1000,
        saEndTemp: 0.5,
        timeLimitMs: 20000,
      };
      break;
    case 'balanced':
    default:
      params = {
        populationSize: 16,
        generations: 20,
        eliteCount: 3,
        tournamentSize: 3,
        swapRate: 0.8,
        rotRate: 0.5,
        saIterations: 400,
        saStartTemp: 1000,
        saEndTemp: 1,
        timeLimitMs: 6000,
      };
      break;
  }
  if (timeLimitMs !== undefined && timeLimitMs > 0) params.timeLimitMs = timeLimitMs;
  return params;
}
