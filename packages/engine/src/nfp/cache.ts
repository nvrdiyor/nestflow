import type { Region } from '../types.js';
import type { OrientedShape } from '../model/prepared.js';
import { noFitPolygon } from './nfp.js';
import { generalInnerFitPolygon } from './ifp.js';

/**
 * Memoises expensive NFP / general-IFP computations across a search run.
 *
 * The key insight: NFP(A, B) depends only on the *orientations* of A and B, not
 * on where A is placed — translating A merely translates its NFP. So NFPs are
 * computed once per ordered orientation pair with A at its local origin, then
 * translated by the placed part's offset at the call site. During GA/SA search
 * the same orientation pairs recur constantly, making this cache the single most
 * important performance lever in the engine.
 */
export class NfpCache {
  private readonly nfpStore = new Map<string, Region>();
  private readonly holeStore = new Map<string, Region>();
  private hits = 0;
  private misses = 0;

  /** NFP of two oriented shapes, with the fixed shape A at its local origin. */
  nfp(a: OrientedShape, b: OrientedShape): Region {
    const key = `${a.key}~${b.key}`;
    const cached = this.nfpStore.get(key);
    if (cached) {
      this.hits++;
      return cached;
    }
    this.misses++;
    const region = noFitPolygon(a.outer, b.outer);
    this.nfpStore.set(key, region);
    return region;
  }

  /**
   * General inner-fit polygon of a part inside a hole, with the hole's owner at
   * its local origin. `holeIndex` distinguishes multiple holes of the owner.
   */
  holeIfp(owner: OrientedShape, holeIndex: number, part: OrientedShape): Region {
    const key = `${owner.key}[${holeIndex}]~${part.key}`;
    const cached = this.holeStore.get(key);
    if (cached) {
      this.hits++;
      return cached;
    }
    this.misses++;
    const hole = owner.holes[holeIndex];
    const region = hole ? generalInnerFitPolygon(hole, part.outer) : [];
    this.holeStore.set(key, region);
    return region;
  }

  stats(): { hits: number; misses: number; size: number } {
    return { hits: this.hits, misses: this.misses, size: this.nfpStore.size + this.holeStore.size };
  }
}
