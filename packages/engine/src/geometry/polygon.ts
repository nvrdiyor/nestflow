import type { Bounds, Contour, Point, Ring } from '../types.js';
import { EPS } from './vector.js';

/**
 * Signed area of a ring via the shoelace formula.
 * Positive result => counter-clockwise winding (in a Y-up frame); negative =>
 * clockwise. Magnitude equals the enclosed area.
 */
export function signedArea(ring: Ring): number {
  const n = ring.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = ring[j] as Point;
    const b = ring[i] as Point;
    sum += (a.x - b.x) * (a.y + b.y);
  }
  return sum / 2;
}

/** Unsigned area enclosed by a ring. */
export function ringArea(ring: Ring): number {
  return Math.abs(signedArea(ring));
}

/** Net area of a contour: outer area minus the area of all holes. */
export function contourArea(contour: Contour): number {
  let area = ringArea(contour.outer);
  for (const hole of contour.holes) area -= ringArea(hole);
  return Math.max(0, area);
}

/** True if the ring is wound counter-clockwise (signed area > 0). */
export function isCounterClockwise(ring: Ring): boolean {
  return signedArea(ring) > 0;
}

/** Returns a copy of the ring wound in the requested direction. */
export function orientRing(ring: Ring, counterClockwise: boolean): Ring {
  const ccw = isCounterClockwise(ring);
  return ccw === counterClockwise ? ring.slice() : ring.slice().reverse();
}

/** Axis-aligned bounds of a ring. Throws on an empty ring. */
export function ringBounds(ring: Ring): Bounds {
  if (ring.length === 0) throw new Error('ringBounds: empty ring');
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
  return { minX, minY, maxX, maxY };
}

/** Axis-aligned bounds of a contour (outer ring dominates). */
export function contourBounds(contour: Contour): Bounds {
  return ringBounds(contour.outer);
}

export function boundsWidth(b: Bounds): number {
  return b.maxX - b.minX;
}

export function boundsHeight(b: Bounds): number {
  return b.maxY - b.minY;
}

export function boundsArea(b: Bounds): number {
  return Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);
}

export function boundsCenter(b: Bounds): Point {
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

/** Converts bounds into a counter-clockwise rectangle ring. */
export function boundsToRing(b: Bounds): Ring {
  return [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ];
}

/** Expands (or shrinks, for negative delta) bounds uniformly on all sides. */
export function inflateBounds(b: Bounds, delta: number): Bounds {
  return {
    minX: b.minX - delta,
    minY: b.minY - delta,
    maxX: b.maxX + delta,
    maxY: b.maxY + delta,
  };
}

/** Perimeter (closed) length of a ring. */
export function ringPerimeter(ring: Ring): number {
  const n = ring.length;
  if (n < 2) return 0;
  let sum = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = ring[j] as Point;
    const b = ring[i] as Point;
    sum += Math.hypot(a.x - b.x, a.y - b.y);
  }
  return sum;
}

/** Total contour perimeter: outer plus every hole. */
export function contourPerimeter(contour: Contour): number {
  let sum = ringPerimeter(contour.outer);
  for (const hole of contour.holes) sum += ringPerimeter(hole);
  return sum;
}

/**
 * Area-weighted centroid of a simple ring. Falls back to the vertex average for
 * degenerate (near-zero-area) rings.
 */
export function ringCentroid(ring: Ring): Point {
  const n = ring.length;
  if (n === 0) return { x: 0, y: 0 };
  let cx = 0;
  let cy = 0;
  let a2 = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const p = ring[j] as Point;
    const q = ring[i] as Point;
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
    a2 += f;
  }
  if (Math.abs(a2) < EPS) {
    let sx = 0;
    let sy = 0;
    for (const p of ring) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / n, y: sy / n };
  }
  const factor = 1 / (3 * a2);
  return { x: cx * factor, y: cy * factor };
}

export function translateRing(ring: Ring, dx: number, dy: number): Ring {
  return ring.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

export function translateContour(contour: Contour, dx: number, dy: number): Contour {
  return {
    outer: translateRing(contour.outer, dx, dy),
    holes: contour.holes.map((h) => translateRing(h, dx, dy)),
  };
}

/**
 * Rotates a ring by `degrees` about `origin` (default: the coordinate origin).
 * Positive angles rotate counter-clockwise in a Y-up frame.
 */
export function rotateRing(ring: Ring, degrees: number, origin: Point = { x: 0, y: 0 }): Ring {
  if (degrees === 0) return ring.map((p) => ({ x: p.x, y: p.y }));
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return ring.map((p) => {
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    return {
      x: origin.x + dx * cos - dy * sin,
      y: origin.y + dx * sin + dy * cos,
    };
  });
}

export function rotateContour(contour: Contour, degrees: number, origin?: Point): Contour {
  return {
    outer: rotateRing(contour.outer, degrees, origin),
    holes: contour.holes.map((h) => rotateRing(h, degrees, origin)),
  };
}

/** Mirrors a ring across the vertical axis x = axisX (default 0). */
export function mirrorRing(ring: Ring, axisX = 0): Ring {
  return ring.map((p) => ({ x: 2 * axisX - p.x, y: p.y }));
}

export function mirrorContour(contour: Contour, axisX = 0): Contour {
  return {
    outer: mirrorRing(contour.outer, axisX),
    holes: contour.holes.map((h) => mirrorRing(h, axisX)),
  };
}

/**
 * Point-in-ring test using the ray-casting (even-odd) rule. Points exactly on an
 * edge are reported according to the standard crossing count and should be
 * treated as boundary cases by callers that care.
 */
export function pointInRing(point: Point, ring: Ring): boolean {
  const n = ring.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = ring[i] as Point;
    const b = ring[j] as Point;
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** True if the point is inside the contour's outer ring and outside all holes. */
export function pointInContour(point: Point, contour: Contour): boolean {
  if (!pointInRing(point, contour.outer)) return false;
  for (const hole of contour.holes) {
    if (pointInRing(point, hole)) return false;
  }
  return true;
}

/**
 * Determines whether a simple ring is convex. Collinear vertices are tolerated.
 * Assumes a non-self-intersecting ring.
 */
export function isConvex(ring: Ring): boolean {
  const n = ring.length;
  if (n < 4) return true; // triangles and degenerate rings are convex
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i] as Point;
    const b = ring[(i + 1) % n] as Point;
    const c = ring[(i + 2) % n] as Point;
    const crossZ = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(crossZ) < EPS) continue;
    const s = crossZ > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** Removes consecutive duplicate vertices (and a trailing point equal to first). */
export function dedupeRing(ring: Ring, eps = EPS): Ring {
  const out: Ring = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > eps || Math.abs(last.y - p.y) > eps) {
      out.push({ x: p.x, y: p.y });
    }
  }
  while (out.length > 1) {
    const first = out[0] as Point;
    const last = out[out.length - 1] as Point;
    if (Math.abs(first.x - last.x) < eps && Math.abs(first.y - last.y) < eps) {
      out.pop();
    } else break;
  }
  return out;
}
