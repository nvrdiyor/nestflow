import type { Region, Ring } from '../types.js';
import { minkowskiSum, reflectRing } from '../geometry/minkowski.js';

/**
 * No-Fit Polygon of a fixed polygon and an orbiting polygon.
 *
 * Definition: NFP(A, B) = A ⊕ (−B). If B's reference origin is translated to a
 * point p, then translate(B, p) overlaps A iff p lies strictly inside NFP(A, B),
 * touches A iff p lies on the NFP boundary, and is clear of A iff p lies outside.
 *
 * Computed as ⋃(triangleᵢ(A) ⊕ triangleⱼ(−B)) — the convex decomposition makes
 * every piece a well-defined convex Minkowski sum, and the union (integer
 * Clipper, non-zero rule) reassembles them into a region that correctly preserves
 * concavities and interior no-fit holes. This is exact for arbitrary non-convex
 * polygons, unlike a direct non-convex Minkowski sum.
 */
export function noFitPolygon(fixed: Ring, orbiting: Ring): Region {
  return minkowskiSum(fixed, reflectRing(orbiting));
}
