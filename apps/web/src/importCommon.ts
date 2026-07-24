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

import { multiply, translate, type Mat } from './matrix';

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
  /** Max simplification deviation (mm) of the nesting polygons — callers add
   *  this to the spacing so TRUE geometry can never end up closer than asked. */
  simplifyTolMm?: number;
}

/**
 * Drops sheet-frame rectangles from a ring soup: a near-exact axis-aligned
 * rectangle spanning ~the whole drawing that encloses several other rings is a
 * drawn sheet border (CorelDRAW page frames, our own exported `frame` layer) —
 * importing it as a part swallows every letter inside it as a "hole" and the
 * whole layout fuses into one giant plate.
 */
export function dropSheetFrames(rings: Ring[]): { rings: Ring[]; dropped: number } {
  if (rings.length < 4) return { rings, dropped: 0 };
  const boxes = rings.map((r) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of r) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  });
  let gMinX = Infinity;
  let gMinY = Infinity;
  let gMaxX = -Infinity;
  let gMaxY = -Infinity;
  for (const b of boxes) {
    gMinX = Math.min(gMinX, b.minX);
    gMinY = Math.min(gMinY, b.minY);
    gMaxX = Math.max(gMaxX, b.maxX);
    gMaxY = Math.max(gMaxY, b.maxY);
  }
  const gArea = Math.max(1e-9, (gMaxX - gMinX) * (gMaxY - gMinY));
  const inside = (o: (typeof boxes)[number], b: (typeof boxes)[number]): boolean =>
    o.minX >= b.minX - 1e-6 && o.maxX <= b.maxX + 1e-6 && o.minY >= b.minY - 1e-6 && o.maxY <= b.maxY + 1e-6;
  const keep: Ring[] = [];
  let dropped = 0;
  for (let i = 0; i < rings.length; i++) {
    const b = boxes[i]!;
    const area = Math.abs(ringArea(rings[i]!));
    // Candidate: a large, near-exact rectangle. (Parts outside the frame — the
    // friend's stray T/L bars — must not disqualify it, so no global-span test.)
    const isRectangle = area >= b.w * b.h * 0.96;
    const isLarge = b.w * b.h >= gArea * 0.25;
    if (isRectangle && isLarge) {
      const contained: Array<(typeof boxes)[number]> = [];
      for (let j = 0; j < boxes.length; j++) {
        if (j !== i && inside(boxes[j]!, b)) contained.push(boxes[j]!);
      }
      // The decisive signal: the rectangle holds MANY rings including a nested
      // pair (a letter with its counter). A plain plate with drilled holes has
      // no nested pairs inside and is kept as a real part.
      let nestedPair = false;
      outer: for (const a of contained) {
        for (const o of contained) {
          if (o !== a && inside(o, a)) {
            nestedPair = true;
            break outer;
          }
        }
      }
      if (contained.length >= 5 && nestedPair) {
        dropped++;
        continue;
      }
    }
    keep.push(rings[i]!);
  }
  return { rings: keep, dropped };
}

/**
 * A point guaranteed to lie INSIDE the ring's material. The centroid is NOT
 * that: a concave letter's centroid sits in its mouth, and when the source
 * layout interlocks letters (a rotated U nested into another U — exactly how
 * sign makers arrange files) the centroid lands on the NEIGHBOUR's body and
 * the containment test fuses two real parts into one. An interior point can
 * only be inside another ring if the parts truly overlap.
 */
export function innerPointOf(ring: Ring): { x: number; y: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const nudge = Math.max(1e-6, Math.hypot(maxX - minX, maxY - minY) * 5e-4);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < nudge) continue;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const nx = -dy / len;
    const ny = dx / len;
    for (const side of [1, -1]) {
      const p = { x: mx + nx * nudge * side, y: my + ny * nudge * side };
      if (pointInRing(p, ring)) return p;
    }
  }
  return ringCentroid(ring);
}

/**
 * Groups rings into contours by even-odd containment depth of each ring's
 * INTERIOR point: even depth = a part's outer, odd depth = a hole of its
 * innermost container. A quote glyph sitting inside an O's counter in the
 * source layout is depth 2 — a standalone part, not a hole of the O.
 */
export function ringsToContours(rings: Ring[]): Contour[] {
  const valid = rings
    .filter((r) => r.length >= 3 && Math.abs(ringArea(r)) > 1e-6)
    .map((r) => ({ ring: r, area: Math.abs(ringArea(r)), probe: innerPointOf(r) }))
    .sort((a, b) => b.area - a.area);

  const contours: Contour[] = [];
  const contourOf: Array<Contour | null> = [];
  for (let i = 0; i < valid.length; i++) {
    let depth = 0;
    let innermost = -1;
    for (let j = 0; j < i; j++) {
      if (pointInRing(valid[i]!.probe, valid[j]!.ring)) {
        depth++;
        innermost = j; // sorted by area desc — the last hit is the smallest container
      }
    }
    if (depth % 2 === 0) {
      const c: Contour = { outer: valid[i]!.ring, holes: [] };
      contours.push(c);
      contourOf.push(c);
    } else {
      const owner = innermost >= 0 ? contourOf[innermost] : null;
      if (owner) owner.holes.push(valid[i]!.ring);
      else contours.push({ outer: valid[i]!.ring, holes: [] });
      contourOf.push(null);
    }
  }
  return contours;
}

const scaleRing = (ring: Ring, mmPerUnit: number): Ring => ring.map((p) => ({ x: p.x * mmPerUnit, y: p.y * mmPerUnit }));

/** Hard cap on nesting-polygon vertices — NFP cost grows explosively past this. */
const MAX_RING_VERTICES = 110;

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
    tol *= 1.6;
    out = simplifyRing(scaled, tol);
  }
  lastFinalizeTol = Math.max(lastFinalizeTol, tol);
  return out;
}

/** Max simplify tolerance used by the current contoursToParts call (module-scoped scratch). */
let lastFinalizeTol = 0;

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
  lastFinalizeTol = 0;

  // Image-to-DXF converters trace BOTH sides of each stroke, so every letter
  // arrives as a hollow shell (a hole covering >=85% of its outer). Shells have
  // ~zero area — the preview looks empty, utilization reads 0.0% and the nest
  // packs phantom outlines that overlap once drawn solid. When MOST of the file
  // shows this signature (>=5 contours and >=30%), flatten the shells to solid
  // shapes. A lone genuine thin frame among normal parts is left untouched.
  const isShell = (c: Contour): boolean => {
    const outerA = Math.abs(ringArea(c.outer));
    if (outerA <= 0) return false;
    return c.holes.some((h) => Math.abs(ringArea(h)) >= outerA * 0.85);
  };
  const shellCount = contours.filter(isShell).length;
  if (shellCount >= 5 && shellCount >= contours.length * 0.3) {
    for (const c of contours) {
      const outerA = Math.abs(ringArea(c.outer));
      c.holes = c.holes.filter((h) => Math.abs(ringArea(h)) < outerA * 0.85);
    }
    warnings.push('Double-outline (traced) contours flattened to solid shapes.');
  }

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
  const simplifyTolMm = lastFinalizeTol;
  return captureFine
    ? { parts, warnings, sources, fineContours, simplifyTolMm }
    : { parts, warnings, simplifyTolMm };
}

const translateRing = (ring: Ring, dx: number, dy: number): Ring => ring.map((p) => ({ x: p.x + dx, y: p.y + dy }));

/**
 * Merges REPEATED shapes into one part with a quantity. A sign job is mostly
 * duplicate letters — "132 parts" is often ~25 unique glyphs — and the NFP
 * cache is keyed by part id, so collapsing duplicates shrinks the search's
 * geometry work by an order of magnitude (and identical letters share a color).
 *
 * Every part is first normalised to its own bbox origin (the placement offset
 * absorbs the difference); the exact source and fine export contour are shifted
 * by the same amount so rendering stays perfectly aligned.
 */
export function dedupeRepeatedParts(
  parts: Part[],
  sources?: Map<string, VectorSource>,
  fineContours?: Map<string, Contour>,
): Part[] {
  const seen = new Map<string, Part>();
  const out: Part[] = [];
  for (const part of parts) {
    let minX = Infinity;
    let minY = Infinity;
    for (const p of part.contour.outer) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
    }
    if (!Number.isFinite(minX)) {
      out.push(part);
      continue;
    }
    part.contour = {
      outer: translateRing(part.contour.outer, -minX, -minY),
      holes: part.contour.holes.map((h) => translateRing(h, -minX, -minY)),
    };
    if (sources) {
      const src = sources.get(part.id);
      if (src) sources.set(part.id, { markup: src.markup, matrix: multiply(translate(-minX, -minY), src.matrix) });
    }
    if (fineContours) {
      const fine = fineContours.get(part.id);
      if (fine) {
        fineContours.set(part.id, {
          outer: translateRing(fine.outer, -minX, -minY),
          holes: fine.holes.map((h) => translateRing(h, -minX, -minY)),
        });
      }
    }
    const ringKey = (r: Ring): string => r.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(';');
    const key = ringKey(part.contour.outer) + '||' + part.contour.holes.map(ringKey).join('|');
    const kept = seen.get(key);
    if (kept) {
      kept.quantity = (kept.quantity ?? 1) + (part.quantity ?? 1);
      sources?.delete(part.id);
      fineContours?.delete(part.id);
    } else {
      seen.set(key, part);
      out.push(part);
    }
  }
  return out;
}
