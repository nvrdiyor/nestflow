import type { Bounds, Point, Region } from '../types.js';
import type { OrientedShape } from '../model/prepared.js';
import type { NfpCache } from '../nfp/cache.js';
import type { PackObjective, PlacedItem } from './types.js';
import { innerFitRect, innerFitRectBounds } from '../nfp/ifp.js';
import { difference, isEmptyRegion, translateRegion, union } from '../geometry/boolean.js';

/**
 * Broad-phase test: could NFP(item, shape) — the region of reference positions
 * where `shape` collides with the placed `item` — overlap the reachable inner-fit
 * range `ifp`? Uses the exact NFP bounding box (A ⊕ (−B) bounds are the sum of the
 * two shapes' bounds), so a false result guarantees the NFP subtraction is a
 * no-op and can be skipped without affecting the result.
 */
function nfpReaches(item: PlacedItem, shape: OrientedShape, ifp: Bounds): boolean {
  const a = item.shape.bounds;
  const b = shape.bounds;
  const minX = a.minX - b.maxX + item.x;
  const maxX = a.maxX - b.minX + item.x;
  const minY = a.minY - b.maxY + item.y;
  const maxY = a.maxY - b.minY + item.y;
  return !(minX > ifp.maxX || maxX < ifp.minX || minY > ifp.maxY || maxY < ifp.minY);
}

/**
 * Computes the feasible region for placing `shape` on a sheet that already holds
 * `placed`. The feasible region is the set of reference translations `t` at
 * which the (grown) part fits inside the usable sheet area and overlaps no
 * placed part.
 *
 *   feasible = IFP(sheet, part)  −  ⋃ NFP(placedᵢ, part)
 *
 * When hole-filling is enabled, positions where the part fits inside a placed
 * part's hole (and clears every other placed part) are added back:
 *
 *   feasible ∪ ⋃_{P, H∈holes(P)} [ IFP(H, part) − ⋃_{Q≠P} NFP(Q, part) ]
 */
export function feasibleRegion(
  usable: Bounds,
  placed: PlacedItem[],
  shape: OrientedShape,
  cache: NfpCache,
  holeFilling: boolean,
): Region {
  const ifpBounds = innerFitRectBounds(usable, shape.outer);
  if (!ifpBounds) return [];
  let region = innerFitRect(usable, shape.outer);

  // Subtract the no-fit polygon of every placed part whose NFP can actually
  // reach the inner-fit region. The broad-phase AABB test below skips NFPs that
  // lie entirely outside the reachable range — an exact no-op that avoids the
  // Clipper call, turning the placement cost from O(n²) toward O(n·local) on
  // large, spread-out sheets.
  const obstacles: Region = [];
  for (const item of placed) {
    if (!nfpReaches(item, shape, ifpBounds)) continue;
    const nfp = cache.nfp(item.shape, shape);
    for (const c of translateRegion(nfp, item.x, item.y)) obstacles.push(c);
  }
  if (obstacles.length) region = difference(region, obstacles);

  if (!holeFilling) return region;

  // Add back valid placements inside the holes of placed parts.
  const holeRegions: Region[] = [];
  for (const item of placed) {
    const holes = item.shape.holes;
    if (holes.length === 0) continue;
    for (let hi = 0; hi < holes.length; hi++) {
      let hf = cache.holeIfp(item.shape, hi, shape);
      if (hf.length === 0) continue;
      hf = translateRegion(hf, item.x, item.y);
      // Exclude collisions with every other placed part (not the hole's owner,
      // whose body legitimately surrounds the hole).
      const others: Region = [];
      for (const other of placed) {
        if (other === item) continue;
        if (!nfpReaches(other, shape, ifpBounds)) continue;
        const nfp = cache.nfp(other.shape, shape);
        for (const c of translateRegion(nfp, other.x, other.y)) others.push(c);
      }
      if (others.length) hf = difference(hf, others);
      if (!isEmptyRegion(hf)) holeRegions.push(hf);
    }
  }
  if (holeRegions.length) region = union(region, ...holeRegions);
  return region;
}

/** A scored candidate reference position for a placement. */
export interface Candidate {
  x: number;
  y: number;
  score: number;
}

/**
 * Selects the best reference position within a feasible region. Because the
 * placement objective is monotone over each cell of the region, its optimum is
 * attained at a boundary vertex — so we evaluate the objective at every vertex.
 *
 * - `bounding-box`: minimise the area of the sheet's combined part bounding box
 *   (corner-gravity compaction), tie-broken toward the origin corner.
 * - `bottom-left`: classic BLF — minimise Y first, then X.
 */
export function chooseReference(
  region: Region,
  sheetBounds: Bounds | null,
  shape: OrientedShape,
  _usable: Bounds,
  objective: PackObjective,
): Candidate | null {
  if (region.length === 0) return null;
  const { minX: sminx, minY: sminy, maxX: smaxx, maxY: smaxy } = shape.bounds;
  const eps = 1e-7;
  // Best candidate held with an explicit (primary, secondary) key pair so the
  // ordering is a true lexicographic comparison — a single fixed-multiplier
  // scalar cannot encode "Y then X" for continuous coordinates (a large X spread
  // can otherwise overpower a sub-unit Y advantage).
  let best: { x: number; y: number; k1: number; k2: number } | null = null;

  const consider = (t: Point): void => {
    const wminx = t.x + sminx;
    const wminy = t.y + sminy;
    const wmaxx = t.x + smaxx;
    const wmaxy = t.y + smaxy;
    let k1: number;
    let k2: number;
    if (objective === 'bottom-left') {
      k1 = wminy;
      k2 = wminx;
    } else {
      let bminx = wminx;
      let bminy = wminy;
      let bmaxx = wmaxx;
      let bmaxy = wmaxy;
      if (sheetBounds) {
        bminx = Math.min(bminx, sheetBounds.minX);
        bminy = Math.min(bminy, sheetBounds.minY);
        bmaxx = Math.max(bmaxx, sheetBounds.maxX);
        bmaxy = Math.max(bmaxy, sheetBounds.maxY);
      }
      k1 = (bmaxx - bminx) * (bmaxy - bminy); // combined bounding-box area
      k2 = wminx + wminy; // corner-gravity tie-break
    }
    if (!best || k1 < best.k1 - eps || (Math.abs(k1 - best.k1) <= eps && k2 < best.k2 - eps)) {
      best = { x: t.x, y: t.y, k1, k2 };
    }
  };

  for (const c of region) {
    for (const p of c.outer) consider(p);
    for (const hole of c.holes) for (const p of hole) consider(p);
  }
  if (!best) return null;
  const b: { x: number; y: number; k1: number; k2: number } = best;
  // `score` exposes the primary key for cross-orientation/cross-sheet ranking.
  return { x: b.x, y: b.y, score: b.k1 };
}
