import type { Region, Ring } from '../types.js';
import { ringArea } from './polygon.js';
import { clip, CT } from './clipper.js';

/**
 * Boolean polygon operations (union / intersection / difference) backed by the
 * integer Clipper library for numerical robustness. The rest of the engine works
 * exclusively with the {@link Region}/{@link import('../types.js').Contour} model;
 * the Clipper representation is fully encapsulated in {@link ./clipper.js}.
 */

/** Minimum absolute area for a region to be considered non-empty. */
const MIN_AREA = 1e-7;

/** Wraps a single ring as a region with no holes. */
export function ringToRegion(ring: Ring): Region {
  return [{ outer: ring, holes: [] }];
}

/** Union of any number of regions; overlapping/adjacent pieces are merged. */
export function union(...regions: Region[]): Region {
  const subject: Region = [];
  for (const region of regions) subject.push(...region);
  if (subject.length === 0) return [];
  return clip(CT.ctUnion, subject, null);
}

/** Union of an array of regions. */
export function unionAll(regions: Region[]): Region {
  return union(...regions);
}

/** Intersection of two regions. */
export function intersection(a: Region, b: Region): Region {
  if (a.length === 0 || b.length === 0) return [];
  return clip(CT.ctIntersection, a, b);
}

/** Region `a` with region `b` removed (a \ b). */
export function difference(a: Region, b: Region): Region {
  if (a.length === 0) return [];
  if (b.length === 0) return clip(CT.ctUnion, a, null);
  return clip(CT.ctDifference, a, b);
}

/** Translates every ring of a region by (dx, dy). */
export function translateRegion(region: Region, dx: number, dy: number): Region {
  if (dx === 0 && dy === 0) return region;
  return region.map((c) => ({
    outer: c.outer.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    holes: c.holes.map((h) => h.map((p) => ({ x: p.x + dx, y: p.y + dy }))),
  }));
}

/** Total net area of a region (outer areas minus holes). */
export function regionArea(region: Region): number {
  let area = 0;
  for (const c of region) {
    area += ringArea(c.outer);
    for (const h of c.holes) area -= ringArea(h);
  }
  return area;
}

/** True when a region encloses no meaningful area. */
export function isEmptyRegion(region: Region): boolean {
  return regionArea(region) < MIN_AREA;
}
