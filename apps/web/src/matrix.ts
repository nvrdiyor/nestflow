/**
 * 2×3 affine matrices in SVG order [a, b, c, d, e, f]:
 *   x' = a·x + c·y + e,  y' = b·x + d·y + f
 * Used to place a part's ORIGINAL vector source (curves intact) at its nested
 * position without ever re-sampling or resizing it.
 */
export type Mat = [number, number, number, number, number, number];

export const identity: Mat = [1, 0, 0, 1, 0, 0];

/** m1 ∘ m2 — apply m2 first, then m1. */
export function multiply(m1: Mat, m2: Mat): Mat {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function translate(x: number, y: number): Mat {
  return [1, 0, 0, 1, x, y];
}

export function rotateDeg(deg: number): Mat {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [cos, sin, -sin, cos, 0, 0];
}

export const mirrorX: Mat = [-1, 0, 0, 1, 0, 0];

/** Inverse of an affine matrix (assumes it is invertible: det ≠ 0). */
export function invert(m: Mat): Mat {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c || 1e-12;
  const ia = d / det;
  const ib = -b / det;
  const ic = -c / det;
  const id = a / det;
  return [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)];
}

/** Bakes a uniform scale into a matrix (scale applied AFTER m). */
export function scaled(m: Mat, s: number): Mat {
  return [m[0] * s, m[1] * s, m[2] * s, m[3] * s, m[4] * s, m[5] * s];
}

export function toSvg(m: Mat): string {
  return `matrix(${m.map((n) => (Number.isFinite(n) ? +n.toFixed(6) : 0)).join(' ')})`;
}
