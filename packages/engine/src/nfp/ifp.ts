import type { Bounds, Region, Ring } from '../types.js';
import { EPS } from '../geometry/vector.js';
import { boundsToRing, inflateBounds, ringBounds } from '../geometry/polygon.js';
import { difference, ringToRegion } from '../geometry/boolean.js';
import { minkowskiSumRegion, reflectRing } from '../geometry/minkowski.js';

/**
 * Inner-Fit Polygon (IFP) computations: the set of reference positions at which
 * a part fits entirely inside a container.
 */

/**
 * Exact inner-fit rectangle for a rectangular container. Returns the axis-aligned
 * range of reference translations `t` such that `partOuter + t` stays within the
 * usable rectangle, or `null` if the part cannot fit at all.
 */
export function innerFitRectBounds(usable: Bounds, partOuter: Ring): Bounds | null {
  const pb = ringBounds(partOuter);
  const b: Bounds = {
    minX: usable.minX - pb.minX,
    maxX: usable.maxX - pb.maxX,
    minY: usable.minY - pb.minY,
    maxY: usable.maxY - pb.maxY,
  };
  if (b.maxX < b.minX - EPS || b.maxY < b.minY - EPS) return null;
  return b;
}

/** Inner-fit rectangle as a region (empty region if the part cannot fit). */
export function innerFitRect(usable: Bounds, partOuter: Ring): Region {
  const b = innerFitRectBounds(usable, partOuter);
  if (!b) return [];
  // Guarantee non-degenerate area so downstream boolean ops keep the region.
  const eps = 1e-6;
  const safe: Bounds = {
    minX: b.minX,
    minY: b.minY,
    maxX: Math.max(b.maxX, b.minX + eps),
    maxY: Math.max(b.maxY, b.minY + eps),
  };
  return ringToRegion(boundsToRing(safe));
}

/**
 * General inner-fit polygon for an arbitrary (non-rectangular) container ring,
 * used for hole-filling. Computes the erosion of the container by the part:
 *
 *   IFP(C, B) = IFP_rect(R, B) \ ((R \ C) ⊕ (−B))
 *
 * where R is C's bounding box padded outward so that `R \ C` forms a clean,
 * non-pinched frame around C. Every valid reference position keeps B fully
 * inside C.
 */
export function generalInnerFitPolygon(container: Ring, partOuter: Ring): Region {
  const cb = ringBounds(container);
  const pb = ringBounds(partOuter);
  const partW = pb.maxX - pb.minX;
  const partH = pb.maxY - pb.minY;

  // Quick reject: the part cannot fit if it is larger than the container extent.
  if (partW > cb.maxX - cb.minX + EPS || partH > cb.maxY - cb.minY + EPS) return [];

  const pad = Math.max(partW, partH) + 1;
  const frameBounds = inflateBounds(cb, pad);
  const frameRegion = ringToRegion(boundsToRing(frameBounds));
  const outside = difference(frameRegion, ringToRegion(container));
  if (outside.length === 0) return innerFitRect(frameBounds, partOuter);

  const forbidden = minkowskiSumRegion(outside, reflectRing(partOuter));
  const ifpRect = innerFitRect(frameBounds, partOuter);
  return difference(ifpRect, forbidden);
}
