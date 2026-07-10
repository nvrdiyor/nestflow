/**
 * Small, fast, seedable pseudo-random number generator (mulberry32).
 *
 * Deterministic given a seed, which is essential for reproducible genetic /
 * simulated-annealing search and for stable tests.
 */
export class Rng {
  private state: number;

  constructor(seed = 0x9e3779b9) {
    // Force to a 32-bit unsigned integer.
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  /** Uniform integer in [min, maxInclusive]. */
  range(min: number, maxInclusive: number): number {
    return min + this.int(maxInclusive - min + 1);
  }

  /** Returns true with the given probability. */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** Picks a random element from a non-empty array. */
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)] as T;
  }

  /** In-place Fisher–Yates shuffle. Returns the same array for convenience. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = items[i] as T;
      items[i] = items[j] as T;
      items[j] = tmp;
    }
    return items;
  }
}
