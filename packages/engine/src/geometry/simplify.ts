import type { Point, Ring, Contour } from '../types.js';

/**
 * Perpendicular distance from point p to the infinite line through a and b.
 */
function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

/**
 * Ramer–Douglas–Peucker simplification of an open polyline.
 * Removes vertices that deviate from the retained polyline by less than
 * `tolerance` (engine units).
 */
export function simplifyPolyline(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2 || tolerance <= 0) return points.map((p) => ({ x: p.x, y: p.y }));

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop() as [number, number];
    let maxDist = 0;
    let index = -1;
    const a = points[start] as Point;
    const b = points[end] as Point;
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDistance(points[i] as Point, a, b);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > tolerance && index !== -1) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }

  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) out.push({ x: (points[i] as Point).x, y: (points[i] as Point).y });
  }
  return out;
}

/**
 * Simplifies a closed ring. The ring is treated as cyclic: the segment closing
 * the last vertex back to the first is preserved.
 */
export function simplifyRing(ring: Ring, tolerance: number): Ring {
  if (ring.length <= 3 || tolerance <= 0) return ring.map((p) => ({ x: p.x, y: p.y }));
  // Duplicate the first point at the end so RDP treats the ring as one polyline,
  // then drop the duplicate.
  const closed = [...ring, ring[0] as Point];
  const simplified = simplifyPolyline(closed, tolerance);
  simplified.pop();
  return simplified.length >= 3 ? simplified : ring.map((p) => ({ x: p.x, y: p.y }));
}

/** Simplifies every ring of a contour. */
export function simplifyContour(contour: Contour, tolerance: number): Contour {
  return {
    outer: simplifyRing(contour.outer, tolerance),
    holes: contour.holes.map((h) => simplifyRing(h, tolerance)),
  };
}
