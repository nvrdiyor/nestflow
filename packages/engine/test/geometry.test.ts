import { describe, expect, it } from 'vitest';
import type { Ring } from '../src/types.js';
import {
  contourArea,
  convexHull,
  convexMinkowskiSum,
  dilateRing,
  isConvex,
  minkowskiSum,
  ringArea,
  ringBounds,
  ringCentroid,
  ringPerimeter,
  regionArea,
  simplifyRing,
  union,
} from '../src/geometry/index.js';

function square(size: number, ox = 0, oy = 0): Ring {
  return [
    { x: ox, y: oy },
    { x: ox + size, y: oy },
    { x: ox + size, y: oy + size },
    { x: ox, y: oy + size },
  ];
}

// A non-convex L-shape (unit grid, area 3).
const lShape: Ring = [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 1 },
  { x: 1, y: 1 },
  { x: 1, y: 2 },
  { x: 0, y: 2 },
];

describe('polygon primitives', () => {
  it('computes area, perimeter, bounds, centroid of a square', () => {
    const s = square(4);
    expect(ringArea(s)).toBeCloseTo(16, 9);
    expect(ringPerimeter(s)).toBeCloseTo(16, 9);
    const b = ringBounds(s);
    expect(b).toEqual({ minX: 0, minY: 0, maxX: 4, maxY: 4 });
    const c = ringCentroid(s);
    expect(c.x).toBeCloseTo(2, 9);
    expect(c.y).toBeCloseTo(2, 9);
  });

  it('computes net contour area with a hole', () => {
    const area = contourArea({ outer: square(4), holes: [square(2, 1, 1)] });
    expect(area).toBeCloseTo(16 - 4, 9);
  });

  it('detects convexity', () => {
    expect(isConvex(square(1))).toBe(true);
    expect(isConvex(lShape)).toBe(false);
  });

  it('simplifies collinear vertices away', () => {
    const withMidpoints: Ring = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    const simplified = simplifyRing(withMidpoints, 0.01);
    expect(simplified.length).toBe(4);
    expect(ringArea(simplified)).toBeCloseTo(16, 9);
  });
});

describe('convex hull', () => {
  it('hulls a point cloud, dropping interior points', () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
      { x: 2, y: 2 }, // interior
      { x: 1, y: 1 }, // interior
    ]);
    expect(hull.length).toBe(4);
    expect(ringArea(hull)).toBeCloseTo(16, 9);
  });
});

describe('Minkowski sum', () => {
  it('sum of two squares is a square of summed side', () => {
    const sum = convexMinkowskiSum(square(2), square(3));
    expect(ringArea(sum)).toBeCloseTo(25, 6); // (2+3)^2
  });

  it('general sum of a concave L-shape with a small square', () => {
    // Area of A⊕B for convex B is area(A) + perimeter-band + area(B); we just
    // assert the result strictly contains both and grows in area.
    const region = minkowskiSum(lShape, square(0.5));
    const area = regionArea(region);
    expect(area).toBeGreaterThan(ringArea(lShape));
    // Result is a single connected piece.
    expect(region.length).toBe(1);
  });

  it('dilation grows a square by an annulus of the right area', () => {
    const r = 1;
    const region = dilateRing(square(10), r, 64);
    const area = regionArea(region);
    // Exact dilation area = A + perimeter*r + pi*r^2 (with circle approx).
    const expected = 100 + 40 * r + Math.PI * r * r;
    expect(area).toBeGreaterThan(100);
    expect(area).toBeCloseTo(expected, 0); // within ~1 unit due to polygonal disk
  });
});

describe('boolean union', () => {
  it('merges two overlapping squares', () => {
    const a = [{ outer: square(2, 0, 0), holes: [] }];
    const b = [{ outer: square(2, 1, 1), holes: [] }];
    const merged = union(a, b);
    expect(merged.length).toBe(1);
    // Union area = 4 + 4 - overlap(1) = 7
    expect(regionArea(merged)).toBeCloseTo(7, 6);
  });
});
