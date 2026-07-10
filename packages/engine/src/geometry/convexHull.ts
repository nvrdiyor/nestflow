import type { Point, Ring } from '../types.js';
import { EPS } from './vector.js';

/**
 * Computes the convex hull of a set of points using Andrew's monotone chain
 * algorithm. Returns a counter-clockwise ring (open, no duplicate closing
 * vertex). Collinear points on the hull edges are removed.
 *
 * Runtime: O(n log n).
 */
export function convexHull(points: readonly Point[]): Ring {
  const pts = points
    .map((p) => ({ x: p.x, y: p.y }))
    .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));

  // Remove exact duplicates to keep the cross-product tests well behaved.
  const unique: Point[] = [];
  for (const p of pts) {
    const last = unique[unique.length - 1];
    if (!last || Math.abs(last.x - p.x) > EPS || Math.abs(last.y - p.y) > EPS) {
      unique.push(p);
    }
  }
  if (unique.length <= 2) return unique;

  const cross = (o: Point, a: Point, b: Point): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Point[] = [];
  for (const p of unique) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2] as Point, lower[lower.length - 1] as Point, p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Point[] = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i] as Point;
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2] as Point, upper[upper.length - 1] as Point, p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}
