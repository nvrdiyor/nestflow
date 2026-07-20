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

import type { Mat } from './matrix';

export const MAX_PARTS = 400;
export const MIN_PART_AREA_MM2 = 1;
export const SIMPLIFY_TOLERANCE_MM = 0.2;

/** Original vector geometry of a part, for exact (curve-preserving) rendering/export. */
export interface VectorSource {
  /** Geometry element in the part's local coordinate space (no transform/style). */
  markup: string;
  /** Local → mm-frame transform (scale × CTM); placement is applied on top. */
  matrix: Mat;
}

export interface ImportResult {
  parts: Part[];
  warnings: string[];
  /** Per-part original geometry for exact rendering (SVG elements, DXF fine polylines). */
  sources?: Map<string, VectorSource>;
  /** Per-part finely-sampled contour (mm) for high-fidelity DXF export. */
  fineContours?: Map<string, Contour>;
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

const scaleRing = (ring: Ring, mmPerUnit: number): Ring => ring.map((p) => ({ x: p.x * mmPerUnit, y: p.y * mmPerUnit }));

/** Hard cap on nesting-polygon vertices — NFP cost grows explosively past this. */
const MAX_RING_VERTICES = 140;

/**
 * Nesting polygon for a ring: simplification scales with the part's size (a
 * 0.2mm tolerance on an 800mm letter keeps hundreds of curve vertices and the
 * NFP search never finishes), and a hard vertex cap bounds the worst case.
 * Cut quality is unaffected — rendering/export use the separate fine geometry.
 */
function finalizeRing(ring: Ring, mmPerUnit: number, tolMm: number): Ring {
  const scaled = scaleRing(ring, mmPerUnit);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of scaled) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const maxDim = Math.max(maxX - minX, maxY - minY, 1);
  let tol = Math.max(tolMm, maxDim / 500);
  let out = simplifyRing(scaled, tol);
  while (out.length > MAX_RING_VERTICES && tol < maxDim / 10) {
    tol *= 1.7;
    out = simplifyRing(scaled, tol);
  }
  return out;
}

const ringD = (ring: Ring): string =>
  'M' + ring.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('L') + 'Z';

/**
 * Scales, simplifies, filters and labels contours into placeable parts.
 * `toleranceMm` controls vertex reduction — a larger value yields lighter
 * polygons, which matters a lot for glossy/curvy shapes (letters) where a high
 * vertex count makes NFP computation explode.
 *
 * With `captureFine`, each part ALSO keeps its unsimplified geometry: an exact
 * <path> source for smooth rendering/SVG export and the fine mm contour for
 * high-fidelity DXF export. The nester still works on the light polygons.
 */
export function contoursToParts(
  contours: Contour[],
  mmPerUnit: number,
  toleranceMm = SIMPLIFY_TOLERANCE_MM,
  startIndex = 0,
  captureFine = false,
): ImportResult {
  const parts: Part[] = [];
  const warnings: string[] = [];
  const sources = new Map<string, VectorSource>();
  const fineContours = new Map<string, Contour>();
  let idx = startIndex;
  for (const c of contours) {
    const outer = finalizeRing(c.outer, mmPerUnit, toleranceMm);
    if (outer.length < 3 || ringArea(outer) < MIN_PART_AREA_MM2) continue;
    const holes = c.holes
      .map((h) => finalizeRing(h, mmPerUnit, toleranceMm))
      .filter((h) => h.length >= 3 && ringArea(h) > MIN_PART_AREA_MM2 * 0.25);
    const id = `p-${idx}`;
    parts.push({ id, label: `shape ${idx + 1}`, contour: { outer, holes }, quantity: 1 });
    if (captureFine) {
      const fine: Contour = {
        outer: scaleRing(c.outer, mmPerUnit),
        holes: c.holes.map((h) => scaleRing(h, mmPerUnit)).filter((h) => h.length >= 3),
      };
      fineContours.set(id, fine);
      sources.set(id, {
        markup: `<path d="${ringD(fine.outer)} ${fine.holes.map(ringD).join(' ')}"/>`,
        matrix: [1, 0, 0, 1, 0, 0],
      });
    }
    idx++;
    if (parts.length >= MAX_PARTS) {
      warnings.push(`Import capped at ${MAX_PARTS} shapes.`);
      break;
    }
  }
  return captureFine ? { parts, warnings, sources, fineContours } : { parts, warnings };
}
