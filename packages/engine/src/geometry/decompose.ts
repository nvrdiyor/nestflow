import earcut from 'earcut';
import type { Point, Ring } from '../types.js';
import { EPS } from './vector.js';
import { isConvex, isCounterClockwise } from './polygon.js';

/**
 * Convex decomposition of a simple polygon via Hertel–Mehlhorn: triangulate,
 * then greedily delete internal diagonals whose removal keeps both incident
 * pieces convex. The result has far fewer pieces than a raw triangulation
 * (typically 2–4×), which is decisive for Minkowski/NFP performance — the cost of
 * a Minkowski sum grows with the product of the two polygons' piece counts, so
 * halving the pieces roughly quarters the work and the size of the union.
 *
 * Guarantees every returned ring is convex and CCW; the pieces tile the input.
 */
export function convexDecompose(ring: Ring): Ring[] {
  if (ring.length < 3) return [];
  if (isConvex(ring)) return [ring];

  const pts: Point[] = isCounterClockwise(ring) ? ring : ring.slice().reverse();
  const n = pts.length;
  const flat = new Array<number>(n * 2);
  for (let i = 0; i < n; i++) {
    flat[i * 2] = pts[i]!.x;
    flat[i * 2 + 1] = pts[i]!.y;
  }
  const tri = earcut(flat);
  if (tri.length === 0) return [pts.map((p) => ({ x: p.x, y: p.y }))];

  // Triangles as CCW index loops.
  let polys: number[][] = [];
  for (let i = 0; i < tri.length; i += 3) {
    const a = tri[i] as number;
    const b = tri[i + 1] as number;
    const c = tri[i + 2] as number;
    polys.push(signedAreaIdx(pts, [a, b, c]) < 0 ? [a, c, b] : [a, b, c]);
  }

  polys = hertelMehlhorn(pts, polys);
  return polys.map((loop) => loop.map((i) => ({ x: pts[i]!.x, y: pts[i]!.y })));
}

function signedAreaIdx(pts: Point[], loop: number[]): number {
  let sum = 0;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = pts[loop[j] as number]!;
    const b = pts[loop[i] as number]!;
    sum += (b.x - a.x) * (b.y + a.y);
  }
  return -sum / 2; // >0 for CCW
}

/** Convex (left/straight turn) test at vertex `idx` of a CCW index loop. */
function convexAt(pts: Point[], loop: number[], idx: number): boolean {
  const L = loop.length;
  const a = pts[loop[(idx - 1 + L) % L] as number]!;
  const b = pts[loop[idx] as number]!;
  const c = pts[loop[(idx + 1) % L] as number]!;
  const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
  return cross >= -EPS;
}

const edgeKey = (u: number, v: number): string => (u < v ? `${u},${v}` : `${v},${u}`);

/** Finds the position of a directed edge a→b in a loop, or -1. */
function findDirectedEdge(loop: number[], a: number, b: number): number {
  const L = loop.length;
  for (let i = 0; i < L; i++) {
    if (loop[i] === a && loop[(i + 1) % L] === b) return i;
  }
  return -1;
}

/** Merges two CCW loops sharing edge {a,b} into one CCW loop. */
function mergeLoops(P: number[], Q: number[], a: number, b: number): number[] | null {
  // Orient so P has a→b and Q has b→a.
  let iP = findDirectedEdge(P, a, b);
  if (iP === -1) {
    [a, b] = [b, a];
    iP = findDirectedEdge(P, a, b);
  }
  if (iP === -1) return null;
  const iQ = findDirectedEdge(Q, b, a);
  if (iQ === -1) return null;

  const lenP = P.length;
  const lenQ = Q.length;
  const result: number[] = [];
  for (let k = 0; k < lenP; k++) result.push(P[(iP + 1 + k) % lenP] as number); // b … a
  for (let k = 0; k < lenQ - 2; k++) result.push(Q[(iQ + 2 + k) % lenQ] as number); // a's Q-side … b's Q-side
  return result;
}

function hertelMehlhorn(pts: Point[], initial: number[][]): number[][] {
  const polys = initial.map((p) => p.slice());
  let changed = true;
  while (changed) {
    changed = false;
    // Map each internal (shared) edge to the two polygons carrying it.
    const map = new Map<string, number[]>();
    for (let pi = 0; pi < polys.length; pi++) {
      const loop = polys[pi] as number[];
      for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        const key = edgeKey(loop[j] as number, loop[i] as number);
        const list = map.get(key);
        if (list) list.push(pi);
        else map.set(key, [pi]);
      }
    }
    for (const [key, owners] of map) {
      if (owners.length !== 2) continue;
      const [a, b] = key.split(',').map(Number) as [number, number];
      const p = owners[0] as number;
      const q = owners[1] as number;
      const merged = mergeLoops(polys[p] as number[], polys[q] as number[], a, b);
      if (!merged || merged.length < 3) continue;
      // Convexity only needs checking at the two junction vertices a and b.
      const ia = merged.indexOf(a);
      const ib = merged.indexOf(b);
      if (ia === -1 || ib === -1) continue;
      if (!convexAt(pts, merged, ia) || !convexAt(pts, merged, ib)) continue;
      // Accept the merge: replace p and q with the merged polygon.
      const keep = Math.min(p, q);
      const drop = Math.max(p, q);
      polys[keep] = merged;
      polys.splice(drop, 1);
      changed = true;
      break;
    }
  }
  return polys;
}
