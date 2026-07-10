import earcut from 'earcut';
import type { Contour, Point, Region, Ring } from '../types.js';
import { EPS } from './vector.js';
import { isConvex, isCounterClockwise, ringArea } from './polygon.js';
import { ringToRegion, unionAll } from './boolean.js';
import { convexDecompose } from './decompose.js';

/**
 * Minkowski-sum machinery. Everything the engine needs geometrically —
 * no-fit polygons, inner-fit polygons, and offset/spacing — reduces to a
 * Minkowski sum of two polygons.
 *
 * Strategy for arbitrary (possibly non-convex) polygons A and B:
 *   A ⊕ B = ⋃_{i,j} (Aᵢ ⊕ Bⱼ)   where {Aᵢ}, {Bⱼ} are convex decompositions.
 * We obtain convex pieces by ear-clipping triangulation (earcut). The Minkowski
 * sum of two convex polygons is computed exactly in O(n+m) by merging edges in
 * angular order; the pieces are then unioned into a clean region.
 */

/** Triangulates a simple ring into convex triangles (each an open 3-vertex ring). */
export function triangulateRing(ring: Ring): Ring[] {
  const n = ring.length;
  if (n < 3) return [];
  if (n === 3) return [ring.map((p) => ({ x: p.x, y: p.y }))];

  const flat: number[] = new Array(n * 2);
  for (let i = 0; i < n; i++) {
    flat[i * 2] = (ring[i] as Point).x;
    flat[i * 2 + 1] = (ring[i] as Point).y;
  }
  const indices = earcut(flat, undefined, 2);
  const tris: Ring[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const a = ring[indices[i] as number] as Point;
    const b = ring[indices[i + 1] as number] as Point;
    const c = ring[indices[i + 2] as number] as Point;
    const tri: Ring = [
      { x: a.x, y: a.y },
      { x: b.x, y: b.y },
      { x: c.x, y: c.y },
    ];
    if (ringArea(tri) > EPS) tris.push(tri);
  }
  return tris;
}

/**
 * Triangulates a contour with holes into convex triangles using earcut's hole
 * support. Enables Minkowski sums of regions that contain holes (needed by the
 * general inner-fit polygon construction).
 */
export function triangulateContour(contour: Contour): Ring[] {
  if (contour.holes.length === 0) return triangulateRing(contour.outer);
  const verts: Point[] = [...contour.outer];
  const holeIndices: number[] = [];
  for (const hole of contour.holes) {
    holeIndices.push(verts.length);
    for (const p of hole) verts.push(p);
  }
  const flat: number[] = new Array(verts.length * 2);
  for (let i = 0; i < verts.length; i++) {
    flat[i * 2] = (verts[i] as Point).x;
    flat[i * 2 + 1] = (verts[i] as Point).y;
  }
  const indices = earcut(flat, holeIndices, 2);
  const tris: Ring[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const a = verts[indices[i] as number] as Point;
    const b = verts[indices[i + 1] as number] as Point;
    const c = verts[indices[i + 2] as number] as Point;
    const tri: Ring = [
      { x: a.x, y: a.y },
      { x: b.x, y: b.y },
      { x: c.x, y: c.y },
    ];
    if (ringArea(tri) > EPS) tris.push(tri);
  }
  return tris;
}

/**
 * Convex decomposition: the polygon itself if already convex, else a
 * Hertel–Mehlhorn convex partition (far fewer pieces than a triangulation,
 * which keeps the Minkowski-sum piece count and union size manageable for
 * high-vertex concave shapes such as letters).
 */
function convexPieces(ring: Ring): Ring[] {
  if (ring.length < 3) return [];
  if (isConvex(ring)) return [ring];
  return convexDecompose(ring);
}

/** Returns a CCW copy of a ring rotated so its lowest (min-y, then min-x) vertex is first. */
function normalizeForMinkowski(ring: Ring): Ring {
  const ccw = isCounterClockwise(ring) ? ring : ring.slice().reverse();
  let lowest = 0;
  for (let i = 1; i < ccw.length; i++) {
    const p = ccw[i] as Point;
    const l = ccw[lowest] as Point;
    if (p.y < l.y || (p.y === l.y && p.x < l.x)) lowest = i;
  }
  const out: Ring = [];
  for (let i = 0; i < ccw.length; i++) {
    out.push(ccw[(lowest + i) % ccw.length] as Point);
  }
  return out;
}

/**
 * Exact Minkowski sum of two CONVEX polygons, via angular edge merging.
 * Both inputs are treated as convex; results are undefined for concave input.
 */
export function convexMinkowskiSum(a: Ring, b: Ring): Ring {
  const A = normalizeForMinkowski(a);
  const B = normalizeForMinkowski(b);
  const n = A.length;
  const m = B.length;
  if (n < 3 || m < 3) return [];

  const edge = (poly: Ring, i: number): Point => {
    const p = poly[i % poly.length] as Point;
    const q = poly[(i + 1) % poly.length] as Point;
    return { x: q.x - p.x, y: q.y - p.y };
  };

  const result: Ring = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    const pa = A[i % n] as Point;
    const pb = B[j % m] as Point;
    result.push({ x: pa.x + pb.x, y: pa.y + pb.y });
    const ea = edge(A, i);
    const eb = edge(B, j);
    const crossZ = ea.x * eb.y - ea.y * eb.x;
    if (i >= n) {
      j++;
    } else if (j >= m) {
      i++;
    } else if (crossZ > 0) {
      i++;
    } else if (crossZ < 0) {
      j++;
    } else {
      i++;
      j++;
    }
  }
  return result;
}

/**
 * Minkowski sum A ⊕ B of two arbitrary simple polygons, returned as a clean
 * region (which may contain holes when A or B is concave).
 */
export function minkowskiSum(a: Ring, b: Ring): Region {
  const aPieces = convexPieces(a);
  const bPieces = convexPieces(b);
  const parts: Region[] = [];
  for (const pa of aPieces) {
    for (const pb of bPieces) {
      const sum = convexMinkowskiSum(pa, pb);
      if (sum.length >= 3 && ringArea(sum) > EPS) parts.push(ringToRegion(sum));
    }
  }
  if (parts.length === 0) return [];
  if (parts.length === 1) return parts[0] as Region;
  return unionAll(parts);
}

/**
 * Minkowski sum of a (possibly holed, possibly disjoint) region with a simple
 * polygon: region ⊕ b = ⋃ (triangleᵢ ⊕ convexPieceⱼ). Distributing over the
 * region's triangulation makes holes and multiple pieces fall out for free.
 */
export function minkowskiSumRegion(region: Region, b: Ring): Region {
  const bPieces = convexPieces(b);
  if (bPieces.length === 0) return [];
  const parts: Region[] = [];
  for (const contour of region) {
    for (const tri of triangulateContour(contour)) {
      for (const pb of bPieces) {
        const sum = convexMinkowskiSum(tri, pb);
        if (sum.length >= 3 && ringArea(sum) > EPS) parts.push(ringToRegion(sum));
      }
    }
  }
  if (parts.length === 0) return [];
  if (parts.length === 1) return parts[0] as Region;
  return unionAll(parts);
}

/** Reflects a ring through the origin: B → −B (used to build no-fit polygons). */
export function reflectRing(ring: Ring): Ring {
  return ring.map((p) => ({ x: -p.x, y: -p.y }));
}

/** A CCW regular polygon of `segments` sides approximating a circle of `radius`. */
export function regularPolygon(radius: number, segments = 16, center: Point = { x: 0, y: 0 }): Ring {
  const n = Math.max(3, Math.floor(segments));
  const ring: Ring = [];
  for (let i = 0; i < n; i++) {
    const theta = (2 * Math.PI * i) / n;
    ring.push({ x: center.x + radius * Math.cos(theta), y: center.y + radius * Math.sin(theta) });
  }
  return ring;
}
