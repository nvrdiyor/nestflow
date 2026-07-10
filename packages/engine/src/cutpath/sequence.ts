import type { Point } from '../types.js';

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Length of an open tour: start → points[order[0]] → … → points[order[n-1]]. */
function tourLength(order: number[], points: Point[], start: Point): number {
  if (order.length === 0) return 0;
  let total = dist(start, points[order[0]!] as Point);
  for (let i = 1; i < order.length; i++) {
    total += dist(points[order[i - 1]!] as Point, points[order[i]!] as Point);
  }
  return total;
}

/**
 * Orders contour lead-in points to minimise rapid-travel distance: a
 * nearest-neighbour tour from the sheet origin, refined by 2-opt. The start is
 * fixed at `start`; the path is open (the tool need not return home).
 */
export function optimizeOrder(points: Point[], start: Point): { order: number[]; travel: number } {
  const n = points.length;
  if (n === 0) return { order: [], travel: 0 };

  // Nearest-neighbour construction.
  const visited = new Array<boolean>(n).fill(false);
  const order: number[] = [];
  let cur = start;
  for (let k = 0; k < n; k++) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      if (visited[i]) continue;
      const d = dist(cur, points[i] as Point);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    visited[best] = true;
    order.push(best);
    cur = points[best] as Point;
  }

  // 2-opt refinement (bounded passes; n is small per sheet).
  const maxPasses = 6;
  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let k = i + 1; k < order.length; k++) {
        const a = i === 0 ? start : (points[order[i - 1]!] as Point);
        const b = points[order[i]!] as Point;
        const c = points[order[k]!] as Point;
        const d = k + 1 < order.length ? (points[order[k + 1]!] as Point) : null;
        const before = dist(a, b) + (d ? dist(c, d) : 0);
        const after = dist(a, c) + (d ? dist(b, d) : 0);
        if (after + 1e-9 < before) {
          let lo = i;
          let hi = k;
          while (lo < hi) {
            const tmp = order[lo]!;
            order[lo] = order[hi]!;
            order[hi] = tmp;
            lo++;
            hi--;
          }
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  return { order, travel: tourLength(order, points, start) };
}
