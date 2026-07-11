import type { Point } from '@nestflow/engine';

/**
 * Evaluates a DXF SPLINE (a B-spline) into a smooth polyline using de Boor's
 * algorithm. This is the correct way to flatten a spline — the previous code
 * connected control points with straight lines, but control points are NOT on
 * the curve, which turned text-as-splines into jagged garbage.
 */
function clampedUniformKnots(n: number, degree: number): number[] {
  const m = n + degree + 1; // highest knot index
  const inner = Math.max(1, n - degree + 1);
  const knots: number[] = [];
  for (let i = 0; i <= m; i++) {
    if (i <= degree) knots.push(0);
    else if (i >= m - degree) knots.push(1);
    else knots.push((i - degree) / inner);
  }
  return knots;
}

function deBoor(u: number, degree: number, ctrl: Point[], knots: number[], n: number): Point {
  let k = degree;
  while (k < n && (knots[k + 1] as number) <= u) k++;
  const d: Point[] = [];
  for (let j = 0; j <= degree; j++) {
    const c = ctrl[k - degree + j] as Point;
    d[j] = { x: c.x, y: c.y };
  }
  for (let r = 1; r <= degree; r++) {
    for (let j = degree; j >= r; j--) {
      const i = k - degree + j;
      const denom = (knots[i + degree - r + 1] as number) - (knots[i] as number);
      const a = denom === 0 ? 0 : (u - (knots[i] as number)) / denom;
      const dj1 = d[j - 1] as Point;
      const dj = d[j] as Point;
      d[j] = { x: (1 - a) * dj1.x + a * dj.x, y: (1 - a) * dj1.y + a * dj.y };
    }
  }
  return d[degree] as Point;
}

/** Samples a B-spline curve into points. Falls back to a clamped-uniform knot
 * vector when the DXF omits (or mis-sizes) the knot list. */
export function sampleBspline(ctrl: Point[], degreeIn: number, knotsIn: number[]): Point[] {
  const n = ctrl.length - 1;
  if (n < 1) return ctrl.map((p) => ({ x: p.x, y: p.y }));
  const degree = Math.min(Math.max(1, Math.round(degreeIn) || 3), n);
  const expected = n + degree + 2;
  const knots = knotsIn.length === expected ? knotsIn : clampedUniformKnots(n, degree);

  const u0 = knots[degree] as number;
  const u1 = knots[n + 1] as number;
  if (!(u1 > u0)) return ctrl.map((p) => ({ x: p.x, y: p.y }));

  const samples = Math.min(2000, Math.max(24, ctrl.length * 10));
  const pts: Point[] = [];
  for (let i = 0; i <= samples; i++) {
    let u = u0 + (u1 - u0) * (i / samples);
    if (i === samples) u = u1 - (u1 - u0) * 1e-9; // stay inside the last span
    pts.push(deBoor(u, degree, ctrl, knots, n));
  }
  return pts;
}
