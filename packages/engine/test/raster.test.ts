import { describe, expect, it } from 'vitest';
import type { Contour, NestConfig, Part, Ring } from '../src/types.js';
import { Rng } from '../src/rng.js';
import { nest, placementContour } from '../src/index.js';
import { bandProfile } from '../src/raster/profile.js';
import { BandSheet } from '../src/raster/sheet.js';
import { convexHull, intersection, regionArea, ringBounds } from '../src/geometry/index.js';
import { offsetRegionClipper } from '../src/geometry/clipper.js';

const rect = (w: number, h: number, x = 0, y = 0): Ring => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

function randomConvex(rng: Rng, id: string, size: number, quantity: number): Part {
  const pts: Ring = [];
  for (let i = 0; i < 8; i++) pts.push({ x: rng.next() * size, y: rng.next() * size });
  const hull = convexHull(pts);
  return { id, contour: { outer: hull.length >= 3 ? hull : rect(size, size), holes: [] }, quantity };
}

/** Pairs of placed parts on the same sheet whose TRUE gap is below `gap` (minus a hair). */
function gapViolations(parts: Part[], result: ReturnType<typeof nest>, gap: number): number {
  const map = new Map(parts.map((p) => [p.id, p]));
  const half = Math.max(0, gap / 2 - 0.005);
  const items = result.placements.map((pl) => {
    const c: Contour = placementContour(map.get(pl.partId)!, pl);
    const grown = half > 0 ? offsetRegionClipper([c], half, 0.001) : [c];
    return { sheet: pl.sheet, grown, b: ringBounds(c.outer) };
  });
  let bad = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!;
      const b = items[j]!;
      if (a.sheet !== b.sheet) continue;
      if (a.b.maxX + gap < b.b.minX || b.b.maxX + gap < a.b.minX || a.b.maxY + gap < b.b.minY || b.b.maxY + gap < a.b.minY) continue;
      if (regionArea(intersection(a.grown, b.grown)) > 1e-6) bad++;
    }
  }
  return bad;
}

describe('raster band profile', () => {
  it('profiles a square exactly: every band spans its full width', () => {
    const p = bandProfile([{ outer: rect(10, 10), holes: [] }], 0.5)!;
    expect(p.rows).toBe(20);
    for (let j = 0; j < p.rows; j++) {
      expect(p.off[j + 1]! - p.off[j]!).toBe(1);
      expect(p.iv[2 * p.off[j]!]).toBeCloseTo(0, 9);
      expect(p.iv[2 * p.off[j]! + 1]).toBeCloseTo(10, 9);
    }
  });

  it('keeps a hole open as a gap in the bands it fully spans', () => {
    const p = bandProfile([{ outer: rect(10, 10), holes: [rect(4, 4, 3, 3)] }], 0.5)!;
    const mid = 10; // band [5, 5.5] lies inside the hole's y-range
    expect(p.off[mid + 1]! - p.off[mid]!).toBe(2);
    expect(p.iv[2 * p.off[mid]! + 1]).toBeCloseTo(3, 9);
    expect(p.iv[2 * p.off[mid]! + 2]).toBeCloseTo(7, 9);
  });

  it('finds the leftmost collision-free x on a band sheet', () => {
    const sheet = new BandSheet(40, 0, 100);
    const block = bandProfile([{ outer: rect(30, 10), holes: [] }], 0.5)!;
    sheet.insert(block, 0, 0); // occupies x ∈ [0, 30], bands 0..19
    const small = bandProfile([{ outer: rect(10, 5), holes: [] }], 0.5)!;
    expect(sheet.fitX(small, 0, 0, 90)).toBeCloseTo(30, 9);
    expect(sheet.fitX(small, 20, 0, 90)).toBeCloseTo(0, 9); // below the block: free from x = 0
    expect(Number.isNaN(sheet.fitX(block, 0, 0, 20))).toBe(true); // no room left of x = 20
  });
});

describe('raster engine (default nest)', () => {
  it('keeps the exact requested gap on true geometry for random shapes', () => {
    const rng = new Rng(4242);
    const parts: Part[] = [];
    for (let i = 0; i < 12; i++) parts.push(randomConvex(rng, `c${i}`, 20 + rng.next() * 60, 1 + rng.int(4)));
    const config: NestConfig = {
      sheet: { width: 400, height: 300, margin: 3 },
      units: 'mm',
      rotations: [0, 90, 180, 270],
      spacing: 2,
      kerf: 0.2,
      holeFilling: false,
      strategy: 'fast',
    };
    const result = nest(parts, config);
    expect(result.unplaced).toHaveLength(0);
    expect(gapViolations(parts, result, 2.2)).toBe(0);
    for (const pl of result.placements) {
      const b = ringBounds(placementContour(parts.find((p) => p.id === pl.partId)!, pl).outer);
      expect(b.minX).toBeGreaterThanOrEqual(3 - 1e-6);
      expect(b.minY).toBeGreaterThanOrEqual(3 - 1e-6);
      expect(b.maxX).toBeLessThanOrEqual(397 + 1e-6);
      expect(b.maxY).toBeLessThanOrEqual(297 + 1e-6);
    }
  });

  it('fills a letter counter with a small part when hole filling is on', () => {
    // The sheet only fits the frame; the 2×2 tiles can only go inside its hole.
    const parts: Part[] = [
      { id: 'frame', contour: { outer: rect(60, 60), holes: [rect(40, 40, 10, 10)] } },
      { id: 'tile', contour: { outer: rect(15, 15), holes: [] }, quantity: 4 },
    ];
    const config: NestConfig = {
      sheet: { width: 64, height: 64 },
      units: 'mm',
      rotations: [0],
      spacing: 2,
      holeFilling: true,
      strategy: 'fast',
    };
    const result = nest(parts, config);
    expect(result.sheetsUsed).toBe(1);
    expect(result.unplaced).toHaveLength(0);
    expect(gapViolations(parts, result, 2)).toBe(0);
  });

  it('fits a part exactly the size of the usable sheet when no clearance is asked', () => {
    const parts: Part[] = [{ id: 'plate', contour: { outer: rect(100, 50), holes: [] } }];
    const result = nest(parts, { sheet: { width: 100, height: 50 }, units: 'mm', rotations: [0], strategy: 'fast' });
    expect(result.unplaced).toHaveLength(0);
    expect(result.sheetsUsed).toBe(1);
  });

  it('nests a 600-part job quickly with nothing lost or overlapping', () => {
    const rng = new Rng(99);
    const parts: Part[] = [];
    for (let i = 0; i < 60; i++) parts.push(randomConvex(rng, `p${i}`, 15 + rng.next() * 45, 10));
    const started = Date.now();
    const result = nest(parts, {
      sheet: { width: 1210, height: 900, margin: 5 },
      units: 'mm',
      rotations: [0, 90, 180, 270],
      spacing: 2,
      strategy: 'fast',
    });
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(result.placements.length + result.unplaced.length).toBe(600);
    expect(result.unplaced).toHaveLength(0);
    expect(gapViolations(parts, result, 2)).toBe(0);
  });
});
