import type { Region, Ring } from '../types.js';
import { EPS } from './vector.js';
import { ringToRegion } from './boolean.js';
import { offsetRingClipper } from './clipper.js';

/**
 * Outward polygon offset (dilation) by `radius`, using Clipper's robust rounded
 * offsetter. Enforces part-to-part spacing and kerf compensation. Returns the
 * ring unchanged (wrapped as a region) for non-positive radii.
 */
export function dilateRing(ring: Ring, radius: number): Region {
  if (radius <= EPS) return ringToRegion(ring.map((p) => ({ x: p.x, y: p.y })));
  return offsetRingClipper(ring, radius);
}

/** Inward polygon offset (erosion) by `radius`. */
export function erodeRing(ring: Ring, radius: number): Region {
  if (radius <= EPS) return ringToRegion(ring.map((p) => ({ x: p.x, y: p.y })));
  return offsetRingClipper(ring, -radius);
}
