import { describe, expect, it } from 'vitest';
import type { NestConfig, Part, Ring } from '../src/types.js';
import { ringPerimeter } from '../src/geometry/index.js';
import {
  cutMetrics,
  detectCommonLines,
  leadInPoint,
  optimizeOrder,
  planCutPath,
  type CutContour,
} from '../src/cutpath/index.js';
import { nest } from '../src/index.js';

function rectRing(x0: number, y0: number, x1: number, y1: number): Ring {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

function contour(partId: string, ring: Ring): CutContour {
  return { partId, instance: 0, sheet: 0, rings: [ring], start: leadInPoint(ring), perimeter: ringPerimeter(ring) };
}

describe('common-line detection', () => {
  it('finds the shared run between two adjacent rectangles', () => {
    const a = contour('A', rectRing(0, 0, 10, 20)); // right edge at x=10
    const b = contour('B', rectRing(11, 0, 21, 20)); // left edge at x=11, gap 1
    const lines = detectCommonLines([a, b], { maxGap: 2, minLength: 8, angleTol: (2 * Math.PI) / 180 });
    expect(lines.length).toBe(1);
    expect(lines[0]!.length).toBeCloseTo(20, 6);
    // Midline sits between the two edges (~x=10.5).
    expect(lines[0]!.a.x).toBeCloseTo(10.5, 3);
  });

  it('finds nothing when parts are far apart', () => {
    const a = contour('A', rectRing(0, 0, 10, 20));
    const b = contour('B', rectRing(40, 0, 50, 20));
    const lines = detectCommonLines([a, b], { maxGap: 2, minLength: 8, angleTol: (2 * Math.PI) / 180 });
    expect(lines).toHaveLength(0);
  });

  it('ignores non-overlapping parallel edges', () => {
    const a = contour('A', rectRing(0, 0, 10, 20));
    const b = contour('B', rectRing(11, 30, 21, 50)); // parallel edges but no vertical overlap
    const lines = detectCommonLines([a, b], { maxGap: 2, minLength: 8, angleTol: (2 * Math.PI) / 180 });
    expect(lines).toHaveLength(0);
  });
});

describe('cut sequence optimisation', () => {
  it('returns a valid permutation and a finite travel length', () => {
    const pts = [
      { x: 100, y: 0 },
      { x: 10, y: 0 },
      { x: 50, y: 0 },
      { x: 0, y: 0 },
    ];
    const { order, travel } = optimizeOrder(pts, { x: 0, y: 0 });
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    expect(travel).toBeGreaterThan(0);
    // Optimal open tour from origin along a line is monotonic: 0,10,50,100.
    expect(order.map((i) => pts[i]!.x)).toEqual([0, 10, 50, 100]);
  });
});

describe('planCutPath integration', () => {
  it('detects common lines and saves cut length on a packed grid', () => {
    const config: NestConfig = {
      sheet: { width: 200, height: 200 },
      units: 'mm',
      rotations: [0],
      spacing: 2,
      holeFilling: false,
      strategy: 'fast',
      machine: { cutSpeed: 20, travelSpeed: 100, hourlyRate: 60 },
    };
    const parts: Part[] = [{ id: 'sq', contour: { outer: rectRing(0, 0, 40, 40), holes: [] }, quantity: 9 }];
    const result = nest(parts, config);
    const plans = planCutPath(result, parts);
    const metrics = cutMetrics(plans, config);

    expect(plans.length).toBeGreaterThanOrEqual(1);
    // Adjacent squares in the grid share edges -> some common length.
    expect(metrics.commonLength).toBeGreaterThan(0);
    expect(metrics.effectiveCutLength).toBeLessThan(metrics.cutLength);
    expect(metrics.savedLength).toBeCloseTo(metrics.commonLength, 9);
    // Each sheet's order is a permutation of its contours.
    for (const p of plans) {
      expect([...p.order].sort((a, b) => a - b)).toEqual(p.contours.map((_, i) => i));
    }
  });
});
