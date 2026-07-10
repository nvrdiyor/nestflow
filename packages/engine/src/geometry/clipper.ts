import ClipperLib from 'clipper-lib';
import type { Path, Paths, PolyNode, PolyTree } from 'clipper-lib';
import type { Contour, Region, Ring } from '../types.js';
import { signedArea } from './polygon.js';

/**
 * Low-level interop with the integer Clipper library. Clipper works on integer
 * coordinates, which is precisely why it is robust where floating-point polygon
 * clippers fail on near-degenerate input. All engine coordinates are scaled by
 * {@link SCALE} on the way in and divided out on the way back.
 */

/** Fixed-point scale: 1 engine unit (mm) → 100 000 integer units (0.01 µm). */
export const SCALE = 100_000;

/** Arc tolerance for round offset joins, in scaled units (~0.05 mm). */
const ARC_TOLERANCE = 0.05 * SCALE;

const { Clipper, ClipperOffset, PolyTree: PolyTreeCtor, ClipType, PolyType, PolyFillType, JoinType, EndType } =
  ClipperLib;

function ringToPath(ring: Ring, forceCcw?: boolean): Path {
  let source = ring;
  if (forceCcw !== undefined) {
    const ccw = signedArea(ring) > 0;
    if (ccw !== forceCcw) source = ring.slice().reverse();
  }
  const path: Path = new Array(source.length);
  for (let i = 0; i < source.length; i++) {
    const p = source[i]!;
    path[i] = { X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) };
  }
  return path;
}

function pathToRing(path: Path): Ring {
  const ring: Ring = new Array(path.length);
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    ring[i] = { x: p.X / SCALE, y: p.Y / SCALE };
  }
  return ring;
}

/**
 * Converts a region to Clipper subject paths, forcing outer rings CCW and holes
 * CW so the non-zero fill rule interprets nesting correctly.
 */
export function regionToPaths(region: Region): Paths {
  const paths: Paths = [];
  for (const contour of region) {
    if (contour.outer.length >= 3) paths.push(ringToPath(contour.outer, true));
    for (const hole of contour.holes) {
      if (hole.length >= 3) paths.push(ringToPath(hole, false));
    }
  }
  return paths;
}

/** Recursively walks a Clipper PolyTree into engine {@link Region} form. */
function walkOuter(outerNode: PolyNode, region: Region): void {
  const outer = pathToRing(outerNode.Contour());
  if (outer.length < 3) return;
  const holes: Ring[] = [];
  for (const holeNode of outerNode.Childs()) {
    const hole = pathToRing(holeNode.Contour());
    if (hole.length >= 3) holes.push(hole);
    // Islands nested inside a hole become their own contours.
    for (const island of holeNode.Childs()) walkOuter(island, region);
  }
  region.push({ outer, holes } as Contour);
}

export function polyTreeToRegion(tree: PolyTree): Region {
  const region: Region = [];
  for (const outerNode of tree.Childs()) walkOuter(outerNode, region);
  return region;
}

/** Runs a boolean clip of subject vs clip regions using the non-zero rule. */
export function clip(clipType: number, subject: Region, clipper: Region | null): Region {
  const c = new Clipper();
  const subjPaths = regionToPaths(subject);
  if (subjPaths.length === 0 && clipType !== ClipType.ctUnion) return [];
  c.AddPaths(subjPaths, PolyType.ptSubject, true);
  if (clipper) c.AddPaths(regionToPaths(clipper), PolyType.ptClip, true);
  const tree = new PolyTreeCtor();
  c.Execute(clipType, tree, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
  return polyTreeToRegion(tree);
}

export const CT = ClipType;

/**
 * Cleans a set of raw Clipper paths (e.g. a self-intersecting Minkowski sum)
 * into a proper region by unioning them under the non-zero rule, letting Clipper
 * resolve outer boundaries and holes.
 */
export function rawPathsToRegion(paths: Paths): Region {
  if (paths.length === 0) return [];
  const c = new Clipper();
  c.AddPaths(paths, PolyType.ptSubject, true);
  const tree = new PolyTreeCtor();
  c.Execute(ClipType.ctUnion, tree, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
  return polyTreeToRegion(tree);
}

/**
 * Outward (delta > 0) or inward (delta < 0) polygon offset with rounded joins,
 * computed by Clipper's numerically robust offsetter.
 */
export function offsetRingClipper(ring: Ring, delta: number): Region {
  const co = new ClipperOffset(2, ARC_TOLERANCE);
  co.AddPath(ringToPath(ring), JoinType.jtRound, EndType.etClosedPolygon);
  const tree = new PolyTreeCtor();
  co.Execute(tree, delta * SCALE);
  return polyTreeToRegion(tree);
}
