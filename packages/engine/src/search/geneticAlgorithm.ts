import type { Rng } from '../rng.js';
import { evaluate, type EvalContext, type Evaluation } from './evaluator.js';
import type { SearchParams } from './strategy.js';
import {
  heuristicChromosome,
  mutate,
  orderCrossover,
  randomChromosome,
  uniformCrossover,
  type Chromosome,
} from './chromosome.js';

interface Individual {
  chromo: Chromosome;
  eval: Evaluation;
}

export interface GaOutcome {
  best: Individual;
  iterations: number;
}

/**
 * Genetic algorithm over (placement order, orientation) chromosomes.
 *
 * Selection: k-way tournament. Crossover: order-crossover (OX) on the placement
 * order plus uniform crossover on orientation genes. Mutation: order swaps and
 * orientation flips. Elitism preserves the best individuals each generation.
 * Population is seeded with the "big parts first" heuristic so the GA never does
 * worse than that reliable baseline.
 */
export function runGeneticAlgorithm(
  ctx: EvalContext,
  counts: number[],
  params: SearchParams,
  rng: Rng,
  deadline: number,
  now: () => number,
  onImprove?: (fitness: number) => void,
): GaOutcome {
  const { instances } = ctx;
  let iterations = 0;

  const evalChromo = (chromo: Chromosome): Individual => {
    iterations++;
    return { chromo, eval: evaluate(ctx, chromo) };
  };

  // Seed population: heuristic first, then random. Honour the deadline while
  // seeding so a large job (whose single evaluation is already costly) cannot
  // overrun its time budget by a full population before the loop even starts.
  let population: Individual[] = [evalChromo(heuristicChromosome(instances))];
  onImprove?.((population[0] as Individual).eval.fitness); // heartbeat from the very first eval
  while (population.length < params.populationSize && now() < deadline) {
    population.push(evalChromo(randomChromosome(instances, counts, rng)));
    onImprove?.((population[population.length - 1] as Individual).eval.fitness); // heartbeat
  }
  population.sort((a, b) => a.eval.fitness - b.eval.fitness);
  let best = population[0] as Individual;
  onImprove?.(best.eval.fitness);

  const tournament = (): Individual => {
    let winner = population[rng.int(population.length)] as Individual;
    for (let i = 1; i < params.tournamentSize; i++) {
      const challenger = population[rng.int(population.length)] as Individual;
      if (challenger.eval.fitness < winner.eval.fitness) winner = challenger;
    }
    return winner;
  };

  for (let gen = 0; gen < params.generations; gen++) {
    if (now() >= deadline) break;
    const next: Individual[] = population.slice(0, params.eliteCount);
    while (next.length < params.populationSize) {
      if (now() >= deadline) break;
      const parentA = tournament();
      const parentB = tournament();
      const order = orderCrossover(parentA.chromo.order, parentB.chromo.order, rng);
      const rotation = uniformCrossover(parentA.chromo.rotation, parentB.chromo.rotation, rng);
      const child = mutate({ order, rotation }, counts, rng, params.swapRate, params.rotRate);
      next.push(evalChromo(child));
      onImprove?.((next[next.length - 1] as Individual).eval.fitness); // heartbeat per eval
    }
    population = next;
    population.sort((a, b) => a.eval.fitness - b.eval.fitness);
    const top = population[0] as Individual;
    if (top.eval.fitness < best.eval.fitness) {
      best = top;
      onImprove?.(best.eval.fitness);
    }
  }

  return { best, iterations };
}
