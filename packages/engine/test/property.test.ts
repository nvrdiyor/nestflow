import { describe, expect, it } from 'vitest';
import type { Contour, NestConfig, Part, Ring } from '../src/types.js';
import { Rng } from '../src/rng.js';
import { nest, placementContour } from '../src/index.js';
import { convexHull, intersection, regionArea, ringBounds } from '../src/geometry/index.js';

/** A random convex polygon (hull of random points) — always simple and valid. */
function randomConvexPart(rng: Rng, id: string, maxSize: number): Part {
  const n = rng.range(5, 10);
  const pts: Ring = [];
  for (let i = 0; i < n; i++) {
    pts.push({ x: rng.next() * maxSize, y: rng.next() * maxSize });
  }
  const hull = convexHull(pts);
  return {
    id,
    contour: { outer: hull.length >= 3 ? hull : [
      { x: 0, y: 0 },
      { x: maxSize, y: 0 },
      { x: maxSize, y: maxSize },
    ], holes: [] },
    quantity: rng.range(1, 4),
  };
}

function worldContour(part: Part, p: { rotation: number; mirrored: boolean; x: number; y: number }): Contour {
  return placementContour(part, {
    partId: part.id,
    instance: 0,
    sheet: 0,
    x: p.x,
    y: p.y,
    rotation: p.rotation,
    mirrored: p.mirrored,
  });
}

describe('property: nesting invariants hold over random inputs', () => {
  for (let seed = 1; seed <= 8; seed++) {
    it(`seed ${seed}: no overlaps, all parts accounted for, all inside sheet`, () => {
      const rng = new Rng(seed * 7919);
      const partCount = rng.range(3, 6);
      const parts: Part[] = [];
      for (let i = 0; i < partCount; i++) {
        parts.push(randomConvexPart(rng, `p${i}`, rng.range(20, 60)));
      }
      const sheetW = rng.range(180, 300);
      const sheetH = rng.range(180, 300);
      const config: NestConfig = {
        sheet: { width: sheetW, height: sheetH, margin: rng.range(0, 4) },
        units: 'mm',
        rotations: rng.chance(0.5) ? [0, 90] : [0, 90, 180, 270],
        spacing: rng.range(0, 3),
        holeFilling: false,
        strategy: 'fast',
        seed: 12345,
      };

      const result = nest(parts, config);
      const totalInstances = parts.reduce((s, p) => s + (p.quantity ?? 1), 0);

      // 1. Every instance is either placed or explicitly unplaced (none lost).
      expect(result.placements.length + result.unplaced.length).toBe(totalInstances);

      const partMap = new Map(parts.map((p) => [p.id, p]));
      const worlds = result.placements.map((pl) => ({
        pl,
        contour: worldContour(partMap.get(pl.partId)!, pl),
      }));

      // 2. Every placed part lies within the sheet (small tolerance).
      for (const w of worlds) {
        const b = ringBounds(w.contour.outer);
        expect(b.minX).toBeGreaterThanOrEqual(-1e-3);
        expect(b.minY).toBeGreaterThanOrEqual(-1e-3);
        expect(b.maxX).toBeLessThanOrEqual(sheetW + 1e-3);
        expect(b.maxY).toBeLessThanOrEqual(sheetH + 1e-3);
      }

      // 3. No two parts on the same sheet overlap.
      for (let i = 0; i < worlds.length; i++) {
        for (let j = i + 1; j < worlds.length; j++) {
          if (worlds[i]!.pl.sheet !== worlds[j]!.pl.sheet) continue;
          const overlap = regionArea(intersection([worlds[i]!.contour], [worlds[j]!.contour]));
          expect(overlap).toBeLessThan(1e-2);
        }
      }
    });
  }
});
