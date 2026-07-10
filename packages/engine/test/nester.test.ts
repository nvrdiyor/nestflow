import { describe, expect, it } from 'vitest';
import type { NestConfig, Part, Ring } from '../src/types.js';
import { nest } from '../src/index.js';

function square(size: number): Ring {
  return [
    { x: 0, y: 0 },
    { x: size, y: 0 },
    { x: size, y: size },
    { x: 0, y: size },
  ];
}

function squareAt(size: number, ox: number, oy: number): Ring {
  return [
    { x: ox, y: oy },
    { x: ox + size, y: oy },
    { x: ox + size, y: oy + size },
    { x: ox, y: oy + size },
  ];
}

function rect(w: number, h: number): Ring {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

describe('nest() end-to-end', () => {
  it('places all parts and reports coherent metrics', () => {
    const config: NestConfig = {
      sheet: { width: 100, height: 100, cost: 20 },
      units: 'mm',
      rotations: [0, 90],
      strategy: 'fast',
      holeFilling: true,
      machine: { cutSpeed: 20, travelSpeed: 100, hourlyRate: 60, pierceTime: 0.5 },
    };
    const parts: Part[] = [
      { id: 'plate', contour: { outer: rect(30, 20), holes: [] }, quantity: 4 },
      { id: 'bar', contour: { outer: rect(45, 8), holes: [] }, quantity: 3 },
      { id: 'ring', contour: { outer: square(24), holes: [squareAt(14, 5, 5)] }, quantity: 2 },
    ];
    const result = nest(parts, config);

    expect(result.unplaced).toHaveLength(0);
    expect(result.placements.length).toBe(4 + 3 + 2);
    expect(result.sheetsUsed).toBeGreaterThanOrEqual(1);
    expect(result.metrics.utilization).toBeGreaterThan(0);
    expect(result.metrics.utilization).toBeLessThanOrEqual(1);
    expect(result.metrics.wastePercent).toBeCloseTo(1 - result.metrics.utilization, 9);
    expect(result.metrics.totalCutLength).toBeGreaterThan(0);
    expect(result.metrics.estimatedCutTimeSec).toBeGreaterThan(0);
    expect(result.metrics.estimatedMachineCost).toBeGreaterThan(0);
    expect(result.metrics.savedMoney).toBeGreaterThanOrEqual(0);
    expect(result.iterations).toBeGreaterThan(0);
  });

  it('computes exact utilization for a known packing', () => {
    const config: NestConfig = {
      sheet: { width: 10, height: 10 },
      units: 'mm',
      rotations: [0],
      strategy: 'fast',
      holeFilling: false,
    };
    // Four 4x4 squares fit on one 10x10 sheet: usedArea 64 of 100.
    const parts: Part[] = [{ id: 'sq', contour: { outer: square(4), holes: [] }, quantity: 4 }];
    const result = nest(parts, config);
    expect(result.sheetsUsed).toBe(1);
    expect(result.metrics.usedArea).toBeCloseTo(64, 6);
    expect(result.metrics.utilization).toBeCloseTo(0.64, 6);
  });

  it('is deterministic for a fixed seed and strategy', () => {
    const config: NestConfig = {
      sheet: { width: 80, height: 60 },
      units: 'mm',
      rotations: [0, 90, 180, 270],
      strategy: 'fast',
      seed: 42,
    };
    const parts: Part[] = [
      { id: 'a', contour: { outer: rect(30, 12), holes: [] }, quantity: 3 },
      { id: 'b', contour: { outer: rect(18, 18), holes: [] }, quantity: 3 },
    ];
    const r1 = nest(parts, config);
    const r2 = nest(parts, config);
    expect(r1.sheetsUsed).toBe(r2.sheetsUsed);
    expect(r1.placements).toEqual(r2.placements);
  });

  it('honours rotation to fit a part that only fits when rotated', () => {
    const config: NestConfig = {
      sheet: { width: 50, height: 12 },
      units: 'mm',
      rotations: [0, 90],
      strategy: 'fast',
    };
    // A 10x40 bar cannot fit in a 12-tall sheet at 0°, but fits rotated to 40x10.
    const parts: Part[] = [{ id: 'bar', contour: { outer: rect(10, 40), holes: [] } }];
    const result = nest(parts, config);
    expect(result.unplaced).toHaveLength(0);
    expect(result.placements[0]?.rotation).toBe(90);
  });

  it('applies spacing so parts do not touch', () => {
    const config: NestConfig = {
      sheet: { width: 100, height: 100 },
      units: 'mm',
      rotations: [0],
      strategy: 'fast',
      spacing: 4,
      holeFilling: false,
    };
    const parts: Part[] = [{ id: 'sq', contour: { outer: square(10), holes: [] }, quantity: 2 }];
    const result = nest(parts, config);
    expect(result.placements).toHaveLength(2);
    // Compare the two placements' bounding boxes: gap along the packing axis >= spacing.
    const [p0, p1] = result.placements;
    const dx = Math.abs((p0!.x) - (p1!.x));
    const dy = Math.abs((p0!.y) - (p1!.y));
    // One axis separation must be at least side (10) + spacing (4).
    expect(Math.max(dx, dy)).toBeGreaterThanOrEqual(10 + 4 - 1e-6);
  });
});
