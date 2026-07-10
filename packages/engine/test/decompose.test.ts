import { describe, expect, it } from 'vitest';
import type { Ring } from '../src/types.js';
import { convexDecompose, isConvex, ringArea } from '../src/geometry/index.js';

const lShape: Ring = [
  { x: 0, y: 0 },
  { x: 3, y: 0 },
  { x: 3, y: 1 },
  { x: 1, y: 1 },
  { x: 1, y: 3 },
  { x: 0, y: 3 },
];

// A plus/cross (12 vertices, 4 reflex).
const cross: Ring = [
  { x: 1, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 1 },
  { x: 3, y: 1 },
  { x: 3, y: 2 },
  { x: 2, y: 2 },
  { x: 2, y: 3 },
  { x: 1, y: 3 },
  { x: 1, y: 2 },
  { x: 0, y: 2 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
];

function totalArea(pieces: Ring[]): number {
  return pieces.reduce((s, p) => s + ringArea(p), 0);
}

describe('convex decomposition (Hertel–Mehlhorn)', () => {
  it('returns the polygon unchanged when already convex', () => {
    const square: Ring = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ];
    const pieces = convexDecompose(square);
    expect(pieces).toHaveLength(1);
  });

  it('decomposes an L-shape into convex pieces that tile it', () => {
    const pieces = convexDecompose(lShape);
    expect(pieces.length).toBeGreaterThanOrEqual(2);
    for (const p of pieces) expect(isConvex(p)).toBe(true);
    expect(totalArea(pieces)).toBeCloseTo(ringArea(lShape), 6);
    // Fewer pieces than a raw triangulation (which would be 4).
    expect(pieces.length).toBeLessThanOrEqual(3);
  });

  it('decomposes a plus/cross into convex pieces that tile it', () => {
    const pieces = convexDecompose(cross);
    expect(pieces.length).toBeGreaterThanOrEqual(3);
    for (const p of pieces) expect(isConvex(p)).toBe(true);
    expect(totalArea(pieces)).toBeCloseTo(ringArea(cross), 6);
    // Triangulation would yield 10 triangles; H-M should do far better.
    expect(pieces.length).toBeLessThan(8);
  });
});
