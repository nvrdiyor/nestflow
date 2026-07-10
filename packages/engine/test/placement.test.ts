import { describe, expect, it } from 'vitest';
import type { Contour, NestConfig, Part, Ring } from '../src/types.js';
import { prepareInstances } from '../src/model/prepared.js';
import { NfpCache } from '../src/nfp/cache.js';
import { greedyPlace, type GreedyResult, type OrientationOf } from '../src/placement/index.js';
import { intersection, regionArea, translateRing } from '../src/geometry/index.js';

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

const AUTO: OrientationOf = () => null;

function run(parts: Part[], config: NestConfig): GreedyResult {
  const instances = prepareInstances(parts, config);
  const usable = {
    minX: config.sheet.margin ?? 0,
    minY: config.sheet.margin ?? 0,
    maxX: config.sheet.width - (config.sheet.margin ?? 0),
    maxY: config.sheet.height - (config.sheet.margin ?? 0),
  };
  const order = instances.map((_, i) => i);
  return greedyPlace(instances, order, AUTO, {
    usable,
    sheetLimit: config.sheet.quantity ?? Infinity,
    holeFilling: config.holeFilling ?? true,
    objective: 'bounding-box',
    cache: new NfpCache(),
  });
}

/** Asserts that no two placed parts overlap (holes are respected). */
function assertNoOverlap(result: GreedyResult): void {
  for (const sheet of result.sheets) {
    for (let i = 0; i < sheet.items.length; i++) {
      for (let j = i + 1; j < sheet.items.length; j++) {
        const a = sheet.items[i]!;
        const b = sheet.items[j]!;
        const regionA = [
          {
            outer: translateRing(a.shape.rawOuter, a.x, a.y),
            holes: a.shape.holes.map((h) => translateRing(h, a.x, a.y)),
          } as Contour,
        ];
        const regionB = [
          {
            outer: translateRing(b.shape.rawOuter, b.x, b.y),
            holes: b.shape.holes.map((h) => translateRing(h, b.x, b.y)),
          } as Contour,
        ];
        const overlap = regionArea(intersection(regionA, regionB));
        expect(overlap).toBeLessThan(1e-3);
      }
    }
  }
}

describe('greedy placement', () => {
  it('packs four squares onto a single sheet without overlap', () => {
    const config: NestConfig = {
      sheet: { width: 10, height: 10 },
      units: 'mm',
      rotations: [0],
      holeFilling: false,
    };
    const parts: Part[] = [{ id: 'sq', contour: { outer: square(4), holes: [] }, quantity: 4 }];
    const result = run(parts, config);
    expect(result.placements).toHaveLength(4);
    expect(result.unplaced).toHaveLength(0);
    const sheetsUsed = new Set(result.placements.map((p) => p.sheet)).size;
    expect(sheetsUsed).toBe(1);
    assertNoOverlap(result);
  });

  it('opens additional sheets when parts do not fit on one', () => {
    const config: NestConfig = {
      sheet: { width: 10, height: 10 },
      units: 'mm',
      rotations: [0],
      holeFilling: false,
    };
    // Six 6x6 squares: only one fits per 10x10 sheet -> 6 sheets.
    const parts: Part[] = [{ id: 'big', contour: { outer: square(6), holes: [] }, quantity: 6 }];
    const result = run(parts, config);
    expect(result.placements).toHaveLength(6);
    expect(result.unplaced).toHaveLength(0);
    const sheetsUsed = new Set(result.placements.map((p) => p.sheet)).size;
    expect(sheetsUsed).toBe(6);
    assertNoOverlap(result);
  });

  it('respects a sheet limit by leaving parts unplaced', () => {
    const config: NestConfig = {
      sheet: { width: 10, height: 10, quantity: 2 },
      units: 'mm',
      rotations: [0],
      holeFilling: false,
    };
    const parts: Part[] = [{ id: 'big', contour: { outer: square(6), holes: [] }, quantity: 5 }];
    const result = run(parts, config);
    expect(result.placements).toHaveLength(2);
    expect(result.unplaced).toHaveLength(3);
    expect(result.unplaced.every((u) => u.reason === 'sheet-limit')).toBe(true);
  });

  it('fills a hole in a large part with a smaller part', () => {
    const config: NestConfig = {
      sheet: { width: 12, height: 12 },
      units: 'mm',
      rotations: [0],
      holeFilling: true,
    };
    const frame: Part = {
      id: 'A',
      contour: { outer: square(10), holes: [squareAt(6, 2, 2)] },
    };
    const small: Part = { id: 'B', contour: { outer: square(4), holes: [] } };
    const result = run([frame, small], config);
    expect(result.placements).toHaveLength(2);
    const sheetsUsed = new Set(result.placements.map((p) => p.sheet)).size;
    expect(sheetsUsed).toBe(1);
    const placedB = result.placements.find((p) => p.partId === 'B');
    expect(placedB?.insideHoleOf).toBe('A');
    assertNoOverlap(result);
  });

  it('does not fill holes when hole-filling is disabled', () => {
    const config: NestConfig = {
      sheet: { width: 12, height: 12 },
      units: 'mm',
      rotations: [0],
      holeFilling: false,
    };
    const frame: Part = {
      id: 'A',
      contour: { outer: square(10), holes: [squareAt(6, 2, 2)] },
    };
    const small: Part = { id: 'B', contour: { outer: square(4), holes: [] } };
    const result = run([frame, small], config);
    const sheetsUsed = new Set(result.placements.map((p) => p.sheet)).size;
    expect(sheetsUsed).toBe(2); // B forced onto a second sheet
    assertNoOverlap(result);
  });
});
