import { describe, expect, it } from 'vitest';
import type { Ring } from '../src/types.js';
import type { OrientedShape } from '../src/model/prepared.js';
import type { PlacedItem } from '../src/placement/index.js';
import { chooseReference } from '../src/placement/index.js';
import { baselineSheetCount } from '../src/metrics/index.js';
import { ringArea, ringBounds, ringPerimeter } from '../src/geometry/index.js';

function rect(w: number, h: number, ox = 0, oy = 0): Ring {
  return [
    { x: ox, y: oy },
    { x: ox + w, y: oy },
    { x: ox + w, y: oy + h },
    { x: ox, y: oy + h },
  ];
}

function stubShape(rawOuter: Ring): OrientedShape {
  const bounds = ringBounds(rawOuter);
  return {
    key: 'stub',
    partId: 'p',
    rotation: 0,
    mirror: false,
    outer: rawOuter,
    holes: [],
    bounds,
    rawOuter,
    netArea: ringArea(rawOuter),
    perimeter: ringPerimeter(rawOuter),
  };
}

function item(rawOuter: Ring): PlacedItem {
  return { shape: stubShape(rawOuter), x: 0, y: 0, partId: 'p', instance: 0 };
}

describe('regression: bottom-left objective is truly lexicographic in (Y, X)', () => {
  it('prefers the lower-Y candidate even when it has a much larger X', () => {
    // Two candidate vertices: A=(1900, 99.7) has lower Y; B=(0, 100) has lower X.
    // A large X term must NOT overpower a sub-unit Y advantage.
    const region = [
      {
        outer: [
          { x: 0, y: 100 },
          { x: 1900, y: 99.7 },
          { x: 1900, y: 200 },
          { x: 0, y: 200 },
        ],
        holes: [],
      },
    ];
    const shape = stubShape(rect(1, 1)); // bounds min at origin
    const usable = { minX: 0, minY: 0, maxX: 2000, maxY: 2000 };
    const chosen = chooseReference(region, null, shape, usable, 'bottom-left');
    expect(chosen).not.toBeNull();
    expect(chosen!.y).toBeCloseTo(99.7, 6); // the strictly-lower-Y vertex wins
    expect(chosen!.x).toBeCloseTo(1900, 6);
  });
});

describe('regression: baselineSheetCount is orientation-aware and does not double-count', () => {
  it('counts a single placeable part as exactly one sheet', () => {
    // 90x40 fits a 100x50 sheet at 0°. Must be 1 sheet, not 2.
    const config = {
      sheet: { width: 100, height: 50 },
      units: 'mm' as const,
    };
    expect(baselineSheetCount([item(rect(90, 40))], config)).toBe(1);
  });

  it('does not misclassify a part that only fits when rotated', () => {
    // 80x40 on a 50-wide, 100-tall sheet: fits only rotated (40 wide, 80 tall).
    const config = { sheet: { width: 50, height: 100 }, units: 'mm' as const };
    expect(baselineSheetCount([item(rect(80, 40))], config)).toBe(1);
  });

  it('opens a fresh sheet after a dedicated oversized part (no refilling)', () => {
    // F1 fills sheet 1; T cannot fit at all -> its own sheet; F2 must start fresh.
    const config = { sheet: { width: 50, height: 100 }, units: 'mm' as const };
    const items = [item(rect(40, 80)), item(rect(60, 60)), item(rect(40, 40))];
    expect(baselineSheetCount(items, config)).toBe(3);
  });

  it('packs several small parts onto a single sheet', () => {
    const config = { sheet: { width: 100, height: 100 }, units: 'mm' as const };
    const items = [item(rect(20, 20)), item(rect(20, 20)), item(rect(20, 20)), item(rect(20, 20))];
    expect(baselineSheetCount(items, config)).toBe(1);
  });
});
