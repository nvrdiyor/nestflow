import { describe, expect, it } from 'vitest';
import type { Point, Ring } from '../src/types.js';
import { bulgeToPoints, fitArcs } from '../src/geometry/arcfit.js';

const circle = (cx: number, cy: number, r: number, n: number, ccw = true): Ring =>
  Array.from({ length: n }, (_, i) => {
    const a = ((ccw ? 1 : -1) * i * 2 * Math.PI) / n;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });

/** Largest distance from any point of `a` to the closed polyline `b`. */
function maxDistance(a: Point[], b: Point[]): number {
  let worst = 0;
  for (const p of a) {
    let best = Infinity;
    for (let i = 0; i < b.length; i++) {
      const s = b[i]!;
      const e = b[(i + 1) % b.length]!;
      const dx = e.x - s.x;
      const dy = e.y - s.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - s.x) * dx + (p.y - s.y) * dy) / l2)) : 0;
      best = Math.min(best, Math.hypot(p.x - s.x - t * dx, p.y - s.y - t * dy));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

describe('arc fitting for DXF export', () => {
  it('turns a finely sampled circle into two half-circle arcs', () => {
    const ring = circle(50, 40, 25, 720);
    const v = fitArcs(ring, 0.01);
    expect(v.length).toBeLessThanOrEqual(3);
    expect(v.every((x) => Math.abs(Math.abs(x.bulge) - 1) < 0.02 || x.bulge === 0)).toBe(true);
    const back = bulgeToPoints(v, 0.005);
    expect(maxDistance(back, ring)).toBeLessThan(0.02);
    expect(maxDistance(ring, back)).toBeLessThan(0.02);
  });

  it('keeps the arc direction: CW input gives negative bulges', () => {
    const v = fitArcs(circle(0, 0, 10, 400, false), 0.01);
    expect(v.filter((x) => x.bulge !== 0).every((x) => x.bulge < 0)).toBe(true);
  });

  it('collapses straight runs and never rounds a real polygon', () => {
    const square: Ring = [];
    for (let i = 0; i < 100; i++) square.push({ x: i, y: 0 });
    for (let i = 0; i < 100; i++) square.push({ x: 100, y: i });
    for (let i = 0; i < 100; i++) square.push({ x: 100 - i, y: 100 });
    for (let i = 0; i < 100; i++) square.push({ x: 0, y: 100 - i });
    const v = fitArcs(square, 0.01);
    expect(v).toHaveLength(4);
    expect(v.every((x) => x.bulge === 0)).toBe(true);
    const octagon = circle(0, 0, 50, 8);
    const o = fitArcs(octagon, 0.02);
    expect(o).toHaveLength(8);
    expect(o.every((x) => x.bulge === 0)).toBe(true);
  });

  it('stays within tolerance on a mixed outline (rounded rectangle + wavy edge)', () => {
    const ring: Ring = [];
    const r = 8;
    const corner = (cx: number, cy: number, a0: number): void => {
      for (let i = 0; i <= 40; i++) {
        const a = a0 + (i / 40) * (Math.PI / 2);
        ring.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
      }
    };
    corner(92, 8, -Math.PI / 2);
    corner(92, 52, 0);
    // Wavy top edge (a sine — not an arc).
    for (let i = 1; i < 200; i++) {
      const x = 92 - (84 * i) / 200;
      ring.push({ x, y: 60 + 1.5 * Math.sin(x / 6) });
    }
    corner(8, 52, Math.PI / 2);
    corner(8, 8, Math.PI);
    const v = fitArcs(ring, 0.02);
    expect(v.length).toBeLessThan(ring.length / 4);
    const back = bulgeToPoints(v, 0.002);
    expect(maxDistance(back, ring)).toBeLessThan(0.03);
    expect(maxDistance(ring, back)).toBeLessThan(0.03);
  });
});
