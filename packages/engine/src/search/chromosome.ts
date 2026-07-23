import type { PartInstance } from '../model/prepared.js';
import type { OrientationOf } from '../placement/index.js';
import type { Rng } from '../rng.js';

/**
 * A candidate solution: the order in which instances are placed, and which
 * orientation each instance uses. `order` is a permutation of instance indices;
 * `rotation[i]` indexes into `instances[i].part.orientationOptions()`.
 */
export interface Chromosome {
  order: number[];
  rotation: number[];
}

/** Number of orientation options available to each instance. */
export function orientationCounts(instances: PartInstance[]): number[] {
  return instances.map((inst) => inst.part.orientationOptions().length);
}

/** Builds the greedy-placement orientation resolver for a chromosome. */
export function decodeOrientation(instances: PartInstance[], rotation: number[]): OrientationOf {
  return (idx: number) => {
    const inst = instances[idx];
    if (!inst) return null;
    const options = inst.part.orientationOptions();
    const choice = options[(rotation[idx] ?? 0) % options.length];
    return choice ?? null;
  };
}

/** A random permutation with random orientations. */
export function randomChromosome(instances: PartInstance[], counts: number[], rng: Rng): Chromosome {
  const order = rng.shuffle(instances.map((_, i) => i));
  const rotation = counts.map((c) => rng.int(c));
  return { order, rotation };
}

/**
 * A strong seed: place the largest parts first (descending net area), all in
 * their first (usually 0°) orientation. This "big parts first" heuristic is a
 * reliable baseline that the search improves upon.
 */
export function heuristicChromosome(instances: PartInstance[]): Chromosome {
  const order = instances
    .map((_, i) => i)
    .sort((a, b) => (instances[b] as PartInstance).part.netArea - (instances[a] as PartInstance).part.netArea);
  const rotation = instances.map(() => 0);
  return { order, rotation };
}

/**
 * Several strong seeds with different orderings. Besides "big area first",
 * height- and width-sorted orders reproduce how a human packs letter jobs into
 * rows of similar height — starting the GA there instead of hoping it discovers
 * row packing on its own. Identical parts sort adjacently, which also warms the
 * NFP cache in long same-glyph runs.
 */
export function heuristicChromosomes(instances: PartInstance[]): Chromosome[] {
  const dims = instances.map((inst) => {
    const rot0 = inst.part.rotations[0] ?? 0;
    const b = inst.part.oriented(rot0, false).bounds;
    return { w: b.maxX - b.minX, h: b.maxY - b.minY, area: inst.part.netArea };
  });
  const zeros = instances.map(() => 0);
  const by = (score: (i: number) => number): Chromosome => ({
    order: instances.map((_, i) => i).sort((a, b) => score(b) - score(a)),
    rotation: zeros.slice(),
  });
  return [
    by((i) => dims[i]!.area),
    by((i) => dims[i]!.h * 1e6 + dims[i]!.w),
    by((i) => dims[i]!.w * 1e6 + dims[i]!.h),
    by((i) => Math.max(dims[i]!.w, dims[i]!.h)),
  ];
}

/**
 * Order crossover (OX): preserves a contiguous slice of parent `a` and fills the
 * remaining positions with parent `b`'s genes in their relative order.
 */
export function orderCrossover(a: number[], b: number[], rng: Rng): number[] {
  const n = a.length;
  if (n < 2) return a.slice();
  let i = rng.int(n);
  let j = rng.int(n);
  if (i > j) [i, j] = [j, i];

  const child = new Array<number>(n).fill(-1);
  const used = new Set<number>();
  for (let k = i; k <= j; k++) {
    child[k] = a[k] as number;
    used.add(a[k] as number);
  }
  let write = (j + 1) % n;
  for (let step = 0; step < n; step++) {
    const gene = b[(j + 1 + step) % n] as number;
    if (!used.has(gene)) {
      child[write] = gene;
      used.add(gene);
      write = (write + 1) % n;
    }
  }
  return child;
}

/** Uniform crossover for the (independent) rotation genes. */
export function uniformCrossover(a: number[], b: number[], rng: Rng): number[] {
  return a.map((v, i) => (rng.chance(0.5) ? v : (b[i] ?? v)));
}

/**
 * Returns a copy with exactly one random move applied — a swap in the placement
 * order or a single orientation change. Used to generate neighbours for
 * simulated annealing, where each step must perturb the state.
 */
export function neighbor(chromo: Chromosome, counts: number[], rng: Rng): Chromosome {
  const order = chromo.order.slice();
  const rotation = chromo.rotation.slice();
  const hasRotatable = counts.some((c) => c > 1);
  const doSwap = order.length >= 2 && (!hasRotatable || rng.chance(0.6));
  if (doSwap) {
    const i = rng.int(order.length);
    let j = rng.int(order.length);
    if (i === j) j = (j + 1) % order.length;
    const tmp = order[i] as number;
    order[i] = order[j] as number;
    order[j] = tmp;
  } else if (hasRotatable) {
    // Pick an instance that actually has alternative orientations.
    let idx = rng.int(rotation.length);
    for (let tries = 0; tries < rotation.length && (counts[idx] ?? 1) <= 1; tries++) {
      idx = (idx + 1) % rotation.length;
    }
    const c = counts[idx] ?? 1;
    if (c > 1) {
      let v = rng.int(c);
      if (v === rotation[idx]) v = (v + 1) % c;
      rotation[idx] = v;
    }
  }
  return { order, rotation };
}

/**
 * Returns a mutated copy: a swap in the placement order with probability
 * `swapRate` and an orientation change with probability `rotRate`.
 */
export function mutate(
  chromo: Chromosome,
  counts: number[],
  rng: Rng,
  swapRate: number,
  rotRate: number,
): Chromosome {
  const order = chromo.order.slice();
  const rotation = chromo.rotation.slice();
  if (order.length >= 2 && rng.chance(swapRate)) {
    const i = rng.int(order.length);
    let j = rng.int(order.length);
    if (i === j) j = (j + 1) % order.length;
    const tmp = order[i] as number;
    order[i] = order[j] as number;
    order[j] = tmp;
  }
  if (rng.chance(rotRate)) {
    const idx = rng.int(rotation.length);
    const c = counts[idx] ?? 1;
    if (c > 1) rotation[idx] = rng.int(c);
  }
  return { order, rotation };
}
