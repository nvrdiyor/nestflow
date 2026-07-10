import {
  pointInRing,
  ringArea,
  ringCentroid,
  simplifyRing,
  type Contour,
  type Part,
  type Ring,
} from '@nestflow/engine';

/** Shared helpers for turning raw imported rings into engine-ready parts. */

export const MAX_PARTS = 400;
export const MIN_PART_AREA_MM2 = 1;
export const SIMPLIFY_TOLERANCE_MM = 0.2;

export interface ImportResult {
  parts: Part[];
  warnings: string[];
}

/** Groups rings into contours: largest rings are outers, rings inside them holes. */
export function ringsToContours(rings: Ring[]): Contour[] {
  const valid = rings
    .filter((r) => r.length >= 3 && Math.abs(ringArea(r)) > 1e-6)
    .map((r) => ({ ring: r, area: Math.abs(ringArea(r)), centroid: ringCentroid(r) }))
    .sort((a, b) => b.area - a.area);

  const used = new Array<boolean>(valid.length).fill(false);
  const contours: Contour[] = [];
  for (let i = 0; i < valid.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const outer = valid[i]!.ring;
    const holes: Ring[] = [];
    for (let j = i + 1; j < valid.length; j++) {
      if (used[j]) continue;
      if (pointInRing(valid[j]!.centroid, outer)) {
        holes.push(valid[j]!.ring);
        used[j] = true;
      }
    }
    contours.push({ outer, holes });
  }
  return contours;
}

function finalizeRing(ring: Ring, mmPerUnit: number, tolMm: number): Ring {
  const scaled = ring.map((p) => ({ x: p.x * mmPerUnit, y: p.y * mmPerUnit }));
  return simplifyRing(scaled, tolMm);
}

/**
 * Scales, simplifies, filters and labels contours into placeable parts.
 * `toleranceMm` controls vertex reduction — a larger value yields lighter
 * polygons, which matters a lot for glossy/curvy shapes (letters) where a high
 * vertex count makes NFP computation explode.
 */
export function contoursToParts(
  contours: Contour[],
  mmPerUnit: number,
  toleranceMm = SIMPLIFY_TOLERANCE_MM,
): ImportResult {
  const parts: Part[] = [];
  const warnings: string[] = [];
  let idx = 0;
  for (const c of contours) {
    const outer = finalizeRing(c.outer, mmPerUnit, toleranceMm);
    if (outer.length < 3 || ringArea(outer) < MIN_PART_AREA_MM2) continue;
    const holes = c.holes
      .map((h) => finalizeRing(h, mmPerUnit, toleranceMm))
      .filter((h) => h.length >= 3 && ringArea(h) > MIN_PART_AREA_MM2 * 0.25);
    parts.push({ id: `p-${idx}`, label: `shape ${idx + 1}`, contour: { outer, holes }, quantity: 1 });
    idx++;
    if (parts.length >= MAX_PARTS) {
      warnings.push(`Import capped at ${MAX_PARTS} shapes.`);
      break;
    }
  }
  return { parts, warnings };
}
