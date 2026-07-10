import type { Point, Ring } from '../types.js';
import type { CommonLine, CutContour } from './types.js';

/** Options controlling common-line detection. */
export interface CommonLineOptions {
  /** Max perpendicular distance between two edges to be a common line. */
  maxGap: number;
  /** Ignore edges/overlaps shorter than this (engine units). */
  minLength: number;
  /** Max angle between edges, in radians. */
  angleTol: number;
}

interface Edge {
  a: Point;
  b: Point;
  ci: number; // contour index
  partId: string;
}

function collectEdges(contours: CutContour[], minLength: number): Edge[] {
  const edges: Edge[] = [];
  for (let ci = 0; ci < contours.length; ci++) {
    const c = contours[ci] as CutContour;
    for (const ring of c.rings) {
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        const a = ring[i] as Point;
        const b = ring[(i + 1) % n] as Point;
        if (Math.hypot(b.x - a.x, b.y - a.y) >= minLength) {
          edges.push({ a, b, ci, partId: c.partId });
        }
      }
    }
  }
  return edges;
}

/**
 * Finds runs shared by two adjacent parts: straight edges that are nearly
 * parallel, within `maxGap` of one another, and overlapping along their length.
 * Such a run can be cut a single time rather than once per part — the essence of
 * common-line cutting.
 */
export function detectCommonLines(contours: CutContour[], opts: CommonLineOptions): CommonLine[] {
  const edges = collectEdges(contours, opts.minLength);
  const result: CommonLine[] = [];
  const sinTol = Math.sin(opts.angleTol);

  for (let i = 0; i < edges.length; i++) {
    const ei = edges[i] as Edge;
    const dix = ei.b.x - ei.a.x;
    const diy = ei.b.y - ei.a.y;
    const li = Math.hypot(dix, diy);
    if (li < opts.minLength) continue;
    const ux = dix / li;
    const uy = diy / li; // unit direction of ei
    const nx = -uy;
    const ny = ux; // unit normal

    for (let j = i + 1; j < edges.length; j++) {
      const ej = edges[j] as Edge;
      if (ej.ci === ei.ci) continue; // same part
      const djx = ej.b.x - ej.a.x;
      const djy = ej.b.y - ej.a.y;
      const lj = Math.hypot(djx, djy);
      if (lj < opts.minLength) continue;

      // Parallel? (cross of unit directions near zero, either orientation)
      const cross = (dix * djy - diy * djx) / (li * lj);
      if (Math.abs(cross) > sinTol) continue;

      // Perpendicular gap from ej.a to the line of ei.
      const gap = Math.abs((ej.a.x - ei.a.x) * nx + (ej.a.y - ei.a.y) * ny);
      if (gap < 1e-6 || gap > opts.maxGap) continue;

      // Overlap along ei's direction.
      const tj1 = (ej.a.x - ei.a.x) * ux + (ej.a.y - ei.a.y) * uy;
      const tj2 = (ej.b.x - ei.a.x) * ux + (ej.b.y - ei.a.y) * uy;
      const lo = Math.max(0, Math.min(tj1, tj2));
      const hi = Math.min(li, Math.max(tj1, tj2));
      const overlap = hi - lo;
      if (overlap < opts.minLength) continue;

      // Midline of the shared run: along ei, shifted half the gap toward ej.
      const side = (ej.a.x - ei.a.x) * nx + (ej.a.y - ei.a.y) * ny >= 0 ? 1 : -1;
      const off = (gap / 2) * side;
      result.push({
        a: { x: ei.a.x + ux * lo + nx * off, y: ei.a.y + uy * lo + ny * off },
        b: { x: ei.a.x + ux * hi + nx * off, y: ei.a.y + uy * hi + ny * off },
        length: overlap,
        partA: ei.partId,
        partB: ej.partId,
      });
    }
  }
  return result;
}

/** Lowest-then-leftmost vertex of a ring — a stable lead-in point. */
export function leadInPoint(ring: Ring): Point {
  let best = ring[0] as Point;
  for (const p of ring) {
    if (p.y < best.y || (p.y === best.y && p.x < best.x)) best = p;
  }
  return { x: best.x, y: best.y };
}
