import { describe, expect, it } from 'vitest';
import type { Ring } from '../src/types.js';
import { regionArea, ringBounds, pointInContour } from '../src/geometry/index.js';
import { noFitPolygon, innerFitRectBounds, generalInnerFitPolygon } from '../src/nfp/index.js';

function square(size: number, ox = 0, oy = 0): Ring {
  return [
    { x: ox, y: oy },
    { x: ox + size, y: oy },
    { x: ox + size, y: oy + size },
    { x: ox, y: oy + size },
  ];
}

describe('no-fit polygon', () => {
  it('NFP of two equal squares is a doubled square', () => {
    const nfp = noFitPolygon(square(2), square(2));
    expect(nfp.length).toBe(1);
    const b = ringBounds((nfp[0] as { outer: Ring }).outer);
    // A ⊕ (−B): bounds [-2,-2]..[2,2]
    expect(b.minX).toBeCloseTo(-2, 6);
    expect(b.minY).toBeCloseTo(-2, 6);
    expect(b.maxX).toBeCloseTo(2, 6);
    expect(b.maxY).toBeCloseTo(2, 6);
    expect(regionArea(nfp)).toBeCloseTo(16, 6);
  });

  it('reference point inside NFP means overlap; outside means clear', () => {
    const nfp = noFitPolygon(square(2), square(2));
    const contour = nfp[0] as { outer: Ring; holes: Ring[] };
    // Placing B at (0,0) exactly overlaps A -> reference inside NFP.
    expect(pointInContour({ x: 0, y: 0 }, contour)).toBe(true);
    // Placing B at (3,0) is clear -> reference outside NFP.
    expect(pointInContour({ x: 3, y: 0 }, contour)).toBe(false);
  });

  it('respects a concave notch: parts nestling in the slot are clear', () => {
    // A U-shape opening upward. Slot occupies x in [2,4], y in [2,6].
    const uShape: Ring = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 6 },
      { x: 4, y: 6 },
      { x: 4, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 6 },
      { x: 0, y: 6 },
    ];
    const nfp = noFitPolygon(uShape, square(1));
    const contour = nfp[0] as { outer: Ring; holes: Ring[] };
    // A 1x1 square placed inside the slot (no wall contact) is clear.
    expect(pointInContour({ x: 2.5, y: 3 }, contour)).toBe(false);
    // A 1x1 square overlapping the left leg is a collision.
    expect(pointInContour({ x: 0.5, y: 3 }, contour)).toBe(true);
  });
});

describe('inner-fit polygon', () => {
  it('rectangular IFP gives the correct translation range', () => {
    const b = innerFitRectBounds({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, square(2));
    expect(b).not.toBeNull();
    expect(b).toEqual({ minX: 0, minY: 0, maxX: 8, maxY: 8 });
  });

  it('rectangular IFP is null when the part is too large', () => {
    const b = innerFitRectBounds({ minX: 0, minY: 0, maxX: 3, maxY: 3 }, square(5));
    expect(b).toBeNull();
  });

  it('general IFP erodes a square container by the part', () => {
    const ifp = generalInnerFitPolygon(square(10), square(2));
    // A 2x2 part fits inside a 10x10 container over an 8x8 range of positions.
    expect(regionArea(ifp)).toBeCloseTo(64, 4);
  });

  it('general IFP is empty when the part cannot fit in the container', () => {
    const ifp = generalInnerFitPolygon(square(3), square(5));
    expect(regionArea(ifp)).toBeCloseTo(0, 6);
  });
});
