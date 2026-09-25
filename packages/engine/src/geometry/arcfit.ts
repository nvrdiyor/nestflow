import type { Point, Ring } from '../types.js';

/**
 * A vertex of an arc-fitted closed outline: the segment to the NEXT vertex is
 * a straight line (bulge 0) or a circular arc with DXF bulge = tan(sweep/4)
 * (positive = counter-clockwise in the ring's own coordinate system).
 */
export interface BulgeVertex {
  x: number;
  y: number;
  bulge: number;
}

const TAU = Math.PI * 2;
/** Arcs are capped at a half turn (bulge ≤ 1) — every CAM reader takes those. */
const MAX_SWEEP = Math.PI + 1e-9;

/**
 * Turns a densely sampled closed outline back into lines and TRUE circular
 * arcs, so a DXF carries real arcs (smooth motion, tiny files) instead of
 * thousands of chords. A run of points becomes one arc only when every
 * sample lies within `tol` of the circle AND every original chord stays
 * within `tol` of it (so a genuine octagon is never rounded into a circle);
 * collinear runs collapse into single lines. The result never deviates from
 * the input polyline by more than ~`tol`.
 */
export function fitArcs(ring: Ring, tol = 0.02): BulgeVertex[] {
  const n = ring.length;
  if (n < 3) return ring.map((p) => ({ x: p.x, y: p.y, bulge: 0 }));
  // Start at the sharpest corner so no arc is cut at an arbitrary seam.
  let start = 0;
  let sharpest = -1;
  for (let i = 0; i < n; i++) {
    const a = ring[(i + n - 1) % n]!;
    const b = ring[i]!;
    const c = ring[(i + 1) % n]!;
    const t = Math.abs(turn(a, b, c));
    if (t > sharpest) {
      sharpest = t;
      start = i;
    }
  }
  const pts: Point[] = [];
  for (let k = 0; k <= n; k++) pts.push(ring[(start + k) % n]!);
  const last = pts.length - 1;

  const out: BulgeVertex[] = [];
  let i = 0;
  while (i < last) {
    const jLine = Math.max(i + 1, extend(i, last, (j) => lineFits(pts, i, j, tol)));
    let jArc = i;
    let sweep = 0;
    if (i + 2 <= last) {
      jArc = extend(i + 1, last, (j) => !Number.isNaN(arcSweep(pts, i, j, tol)));
      if (jArc - i >= 2) sweep = arcSweep(pts, i, jArc, tol);
      else jArc = i;
    }
    const p = pts[i]!;
    if (jArc > jLine && !Number.isNaN(sweep)) {
      out.push({ x: p.x, y: p.y, bulge: Math.tan(sweep / 4) });
      i = jArc;
    } else {
      out.push({ x: p.x, y: p.y, bulge: 0 });
      i = Math.max(i + 1, jLine);
    }
  }
  return out;
}

/** Signed turning angle at b (a → b → c). */
function turn(a: Point, b: Point, c: Point): number {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
}

/**
 * Largest j in (from, last] with fits(j) (or `from` when none), assuming fits is (nearly) monotone:
 * gallop 1, 2, 4, … then binary-search the boundary — O(k log k) per run.
 */
function extend(from: number, last: number, fits: (j: number) => boolean): number {
  if (from + 1 > last || !fits(from + 1)) return from;
  let ok = from + 1;
  let step = 1;
  let bad = -1;
  for (;;) {
    const j = Math.min(last, ok + step);
    if (j === ok) break;
    if (fits(j)) {
      ok = j;
      if (j === last) break;
      step *= 2;
    } else {
      bad = j;
      break;
    }
  }
  if (bad < 0) return ok;
  let lo = ok;
  let hi = bad;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

function lineFits(pts: Point[], i: number, j: number, tol: number): boolean {
  if (j - i <= 1) return true;
  const a = pts[i]!;
  const b = pts[j]!;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return false;
  let prevT = -Infinity;
  for (let k = i + 1; k < j; k++) {
    const p = pts[k]!;
    const d = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
    if (d > tol) return false;
    const t = (p.x - a.x) * dx + (p.y - a.y) * dy;
    if (t < prevT - 1e-9) return false; // doubling back
    prevT = t;
  }
  return true;
}

/** Signed sweep of the arc through pts[i..j] when it fits within tol, else NaN. */
function arcSweep(pts: Point[], i: number, j: number, tol: number): number {
  const a = pts[i]!;
  const m = pts[(i + j) >> 1]!;
  const b = pts[j]!;
  const d = 2 * (a.x * (m.y - b.y) + m.x * (b.y - a.y) + b.x * (a.y - m.y));
  if (Math.abs(d) < 1e-12) return Number.NaN;
  const a2 = a.x * a.x + a.y * a.y;
  const m2 = m.x * m.x + m.y * m.y;
  const b2 = b.x * b.x + b.y * b.y;
  const cx = (a2 * (m.y - b.y) + m2 * (b.y - a.y) + b2 * (a.y - m.y)) / d;
  const cy = (a2 * (b.x - m.x) + m2 * (a.x - b.x) + b2 * (m.x - a.x)) / d;
  const r = Math.hypot(a.x - cx, a.y - cy);
  if (!(r > tol) || r > 1e5) return Number.NaN;
  let sweep = 0;
  let sign = 0;
  let prevAng = Math.atan2(a.y - cy, a.x - cx);
  for (let k = i + 1; k <= j; k++) {
    const p = pts[k]!;
    if (Math.abs(Math.hypot(p.x - cx, p.y - cy) - r) > tol) return Number.NaN;
    const q = pts[k - 1]!;
    const half = Math.hypot(p.x - q.x, p.y - q.y) / 2;
    if (half >= r || r - Math.sqrt(r * r - half * half) > tol) return Number.NaN; // chord sagitta
    const ang = Math.atan2(p.y - cy, p.x - cx);
    let delta = ang - prevAng;
    if (delta > Math.PI) delta -= TAU;
    else if (delta <= -Math.PI) delta += TAU;
    if (Math.abs(delta) > Math.PI / 4 || delta === 0) return Number.NaN;
    const s = Math.sign(delta);
    if (sign === 0) sign = s;
    else if (s !== sign) return Number.NaN;
    sweep += delta;
    prevAng = ang;
  }
  if (Math.abs(sweep) > MAX_SWEEP) return Number.NaN;
  return sweep;
}

/** Samples a bulge polyline back into points (for tests and previews). */
export function bulgeToPoints(verts: BulgeVertex[], stepRad = 0.02): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i]!;
    const w = verts[(i + 1) % verts.length]!;
    out.push({ x: v.x, y: v.y });
    if (v.bulge === 0) continue;
    const sweep = 4 * Math.atan(v.bulge);
    const chord = Math.hypot(w.x - v.x, w.y - v.y);
    const r = chord / (2 * Math.sin(Math.abs(sweep) / 2));
    // Centre: from the chord midpoint along its normal, on the bulge's side.
    const mx = (v.x + w.x) / 2;
    const my = (v.y + w.y) / 2;
    const h = r * Math.cos(sweep / 2);
    const nx = -(w.y - v.y) / chord;
    const ny = (w.x - v.x) / chord;
    const cx = mx + nx * h * Math.sign(sweep);
    const cy = my + ny * h * Math.sign(sweep);
    const a0 = Math.atan2(v.y - cy, v.x - cx);
    const steps = Math.max(2, Math.ceil(Math.abs(sweep) / stepRad));
    for (let s = 1; s < steps; s++) {
      const a = a0 + (sweep * s) / steps;
      out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
  }
  return out;
}
