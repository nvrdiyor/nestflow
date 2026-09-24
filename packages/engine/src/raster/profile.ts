import type { Region, Ring } from '../types.js';

/**
 * Band (scanline) occupancy profile of a shape.
 *
 * The shape is cut into horizontal bands of height `h`. For every band the
 * profile stores the x-intervals where the shape has material ANYWHERE inside
 * that band — the exact projection of (shape ∩ band) onto the x axis. X stays
 * continuous (exact); only Y is quantised, and conservatively: if two profiles
 * placed on the same band grid have disjoint intervals in every shared band,
 * the shapes themselves are guaranteed disjoint.
 *
 * This representation is what lets the raster nester handle thousands of parts
 * with arbitrary vertex counts: a collision test is a handful of binary
 * searches per band instead of a polygon boolean, and holes (letter counters)
 * are simply gaps in a band.
 */
export interface BandProfile {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Number of bands (rows); row j covers local y ∈ [minY + j·h, minY + (j+1)·h]. */
  rows: number;
  /** CSR offsets: row j's intervals are iv[2·off[j] .. 2·off[j+1]). */
  off: Int32Array;
  /** Interval endpoints, flat [a0, b0, a1, b1, …], sorted and disjoint per row. */
  iv: Float64Array;
  /** Rows holding the widest single intervals (and those widths) — candidate-skipping probes. */
  probeRow: Int32Array;
  probeW: Float64Array;
  /** Row visiting order that spreads early checks across the shape (collisions surface fast). */
  order: Int32Array;
  /** Σ interval width × h — the band-cell area the shape occupies. */
  cellArea: number;
}

/** Exact x-projection of every ring's material inside each band, via one edge sweep. */
export function bandProfile(region: Region, h: number): BandProfile | null {
  const rings: Ring[] = [];
  for (const c of region) {
    if (c.outer.length >= 3) rings.push(c.outer);
    for (const hole of c.holes) if (hole.length >= 3) rings.push(hole);
  }
  if (rings.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rings) {
    for (const p of r) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX) || maxX - minX <= 0 || maxY - minY <= 0) return null;

  const rows = Math.max(1, Math.ceil((maxY - minY) / h - 1e-9));
  const rowIv: number[][] = new Array(rows);
  for (let j = 0; j < rows; j++) rowIv[j] = [];
  const lineX: number[][] = new Array(rows + 1);
  for (let l = 0; l <= rows; l++) lineX[l] = [];

  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const p = ring[i]!;
      const q = ring[(i + 1) % n]!;
      const ylo = p.y < q.y ? p.y : q.y;
      const yhi = p.y < q.y ? q.y : p.y;
      let r0 = Math.floor((ylo - minY) / h);
      let r1 = Math.floor((yhi - minY) / h);
      if (r0 < 0) r0 = 0;
      if (r1 > rows - 1) r1 = rows - 1;
      const dy = q.y - p.y;
      // (1) The boundary itself: the edge clipped to each band it spans.
      if (dy === 0) {
        const a = p.x < q.x ? p.x : q.x;
        const b = p.x < q.x ? q.x : p.x;
        for (let r = r0; r <= r1; r++) rowIv[r]!.push(a, b);
      } else {
        const slope = (q.x - p.x) / dy;
        for (let r = r0; r <= r1; r++) {
          const bLo = minY + r * h;
          const bHi = bLo + h;
          const y1 = ylo > bLo ? ylo : bLo;
          const y2 = yhi < bHi ? yhi : bHi;
          const x1 = p.x + (y1 - p.y) * slope;
          const x2 = p.x + (y2 - p.y) * slope;
          if (x1 < x2) rowIv[r]!.push(x1, x2);
          else rowIv[r]!.push(x2, x1);
        }
        // (2) Crossings with the band boundary lines (interior cross-sections).
        let l0 = Math.ceil((ylo - minY) / h);
        let l1 = Math.floor((yhi - minY) / h);
        if (l0 < 0) l0 = 0;
        if (l1 > rows) l1 = rows;
        for (let l = l0; l <= l1; l++) {
          const yl = minY + l * h;
          if (p.y <= yl !== q.y <= yl) lineX[l]!.push(p.x + (yl - p.y) * slope);
        }
      }
    }
  }

  // Interior spans on each band boundary line (even-odd) belong to both
  // neighbouring bands.
  for (let l = 0; l <= rows; l++) {
    const xs = lineX[l]!;
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    const pushSpan = (a: number, b: number): void => {
      if (l - 1 >= 0) rowIv[l - 1]!.push(a, b);
      if (l < rows) rowIv[l]!.push(a, b);
    };
    if (xs.length % 2 === 1) {
      // Inconsistent crossing parity (degenerate input): be conservative.
      pushSpan(xs[0]!, xs[xs.length - 1]!);
      continue;
    }
    for (let i = 0; i + 1 < xs.length; i += 2) pushSpan(xs[i]!, xs[i + 1]!);
  }

  // Sort + merge each row into disjoint intervals, packed into CSR arrays.
  const off = new Int32Array(rows + 1);
  const flat: number[] = [];
  const widest = new Float64Array(rows);
  let cellArea = 0;
  const pairIdx: number[] = [];
  for (let j = 0; j < rows; j++) {
    off[j] = flat.length / 2;
    const raw = rowIv[j]!;
    const cnt = raw.length / 2;
    if (cnt === 0) continue;
    pairIdx.length = cnt;
    for (let i = 0; i < cnt; i++) pairIdx[i] = i;
    pairIdx.sort((u, v) => raw[2 * u]! - raw[2 * v]!);
    let ca = raw[2 * pairIdx[0]!]!;
    let cb = raw[2 * pairIdx[0]! + 1]!;
    for (let i = 1; i < cnt; i++) {
      const a = raw[2 * pairIdx[i]!]!;
      const b = raw[2 * pairIdx[i]! + 1]!;
      if (a <= cb + 1e-9) {
        if (b > cb) cb = b;
      } else {
        flat.push(ca, cb);
        if (cb - ca > widest[j]!) widest[j] = cb - ca;
        cellArea += (cb - ca) * h;
        ca = a;
        cb = b;
      }
    }
    flat.push(ca, cb);
    if (cb - ca > widest[j]!) widest[j] = cb - ca;
    cellArea += (cb - ca) * h;
  }
  off[rows] = flat.length / 2;

  // Probe rows: the widest intervals, spread over the shape. They need the
  // biggest gaps, so they reject most bands and are checked first in fitX.
  const minSep = Math.max(1, Math.floor(rows / 4));
  const wideRows: number[] = [];
  const byWidth = Array.from({ length: rows }, (_, j) => j)
    .filter((j) => off[j + 1]! > off[j]!)
    .sort((a, b) => widest[b]! - widest[a]!);
  for (const j of byWidth) {
    if (wideRows.length >= 3) break;
    if (wideRows.every((c) => Math.abs(c - j) >= minSep)) wideRows.push(j);
  }
  const probeRow = Int32Array.from(wideRows);
  const probeW = Float64Array.from(wideRows.map((j) => widest[j]!));

  // Visiting order for fitX: probe rows first, then coarse-to-fine (0, s, 2s, … then midpoints).
  const order = new Int32Array(rows);
  const seen = new Uint8Array(rows);
  let w = 0;
  for (const j of wideRows) {
    seen[j] = 1;
    order[w++] = j;
  }
  let step = 1;
  while (step * 2 <= rows) step *= 2;
  for (; step >= 1; step = Math.floor(step / 2)) {
    for (let j = 0; j < rows; j += step) {
      if (!seen[j]) {
        seen[j] = 1;
        order[w++] = j;
      }
    }
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    rows,
    off,
    iv: Float64Array.from(flat),
    probeRow,
    probeW,
    order,
    cellArea,
  };
}
