import type { Point } from '../types.js';

/** Numerical tolerance for geometric comparisons (engine units). */
export const EPS = 1e-9;

export function almostEqual(a: number, b: number, eps = EPS): boolean {
  return Math.abs(a - b) < eps;
}

export function pointsEqual(a: Point, b: Point, eps = EPS): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
}

export function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Point, s: number): Point {
  return { x: a.x * s, y: a.y * s };
}

export function negate(a: Point): Point {
  return { x: -a.x, y: -a.y };
}

/** Dot product. */
export function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}

/** 2D cross product (z-component of the 3D cross). */
export function cross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x;
}

export function length(a: Point): number {
  return Math.hypot(a.x, a.y);
}

export function lengthSq(a: Point): number {
  return a.x * a.x + a.y * a.y;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distanceSq(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function normalize(a: Point): Point {
  const len = length(a);
  if (len < EPS) return { x: 0, y: 0 };
  return { x: a.x / len, y: a.y / len };
}

/**
 * Orientation of the ordered triple (a, b, c):
 *   > 0  counter-clockwise (left turn)
 *   < 0  clockwise (right turn)
 *   = 0  collinear
 */
export function orient(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
