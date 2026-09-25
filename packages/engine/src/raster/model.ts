import type { Bounds, Contour, Region, Remnant } from '../types.js';
import type { OrientedShape, PartInstance, PreparedPart } from '../model/prepared.js';
import { contourPerimeter, mirrorContour, ringArea, ringBounds, rotateContour } from '../geometry/polygon.js';
import { simplifyRing } from '../geometry/simplify.js';
import { offsetRegionClipper } from '../geometry/clipper.js';
import { bandProfile, type BandProfile } from './profile.js';

/** One placeable orientation of a part: exact raw geometry + its band profile. */
export interface RasterShape {
  /** Dense index across the whole model (resume-cache slot). */
  id: number;
  shape: OrientedShape;
  prof: BandProfile;
}

export interface RasterPartModel {
  part: PreparedPart;
  /** Distinct orientations that fit an empty sheet (empty = too large). */
  options: RasterShape[];
}

export interface RasterModel {
  /** Band height (mm). */
  h: number;
  /** World y of band 0's top edge. */
  y0: number;
  bandCount: number;
  xMin: number;
  xMax: number;
  shapeCount: number;
  /** Per instance index → its part model. */
  byInstance: RasterPartModel[];
  parts: RasterPartModel[];
  /** Per remnant: its blocked area (grown by the clearance) on the band grid, at band `k`. */
  remnants: Array<{ prof: BandProfile; k: number } | null>;
}

export interface RasterModelOptions {
  usable: Bounds;
  /** Gap kept around every part = spacing/2 + kerf/2. */
  clearance: number;
  holeFilling: boolean;
  /** Band height override (mm). */
  bandHeight?: number;
  /** Partly used sheets that open the layout. */
  remnants?: Remnant[];
  onTick?: () => void;
}

/** Vertex-reduction tolerance for the collision geometry; added to the dilation so it stays conservative. */
const SIMPLIFY_MM = 0.02;
/** Max inward deviation of Clipper's chorded round joins; also added to the dilation. */
const ARC_TOL_MM = 0.01;

/** Band height: fine enough that the y-quantisation costs a fraction of a millimetre. */
export function defaultBandHeight(usable: Bounds): number {
  const h = (usable.maxY - usable.minY) / 3000;
  return Math.min(0.6, Math.max(0.2, h));
}

function transformRegion(region: Region, rotation: number, mirror: boolean): Region {
  return region.map((c) => {
    let t: Contour = c;
    if (mirror) t = mirrorContour(t, 0);
    return rotateContour(t, rotation);
  });
}

function largestOuter(region: Region): Contour['outer'] {
  let best = region[0]!.outer;
  let bestA = ringArea(best);
  for (let i = 1; i < region.length; i++) {
    const a = ringArea(region[i]!.outer);
    if (a > bestA) {
      bestA = a;
      best = region[i]!.outer;
    }
  }
  return best;
}

function profileKey(p: BandProfile): string {
  const parts: string[] = [String(p.rows)];
  for (let j = 0; j < p.rows; j++) {
    for (let q = p.off[j]!; q < p.off[j + 1]!; q++) {
      parts.push(`${(p.iv[2 * q]! - p.minX).toFixed(2)},${(p.iv[2 * q + 1]! - p.minX).toFixed(2)}`);
    }
    parts.push('|');
  }
  return parts.join(';');
}

/**
 * Builds the collision model: every distinct part is grown by the clearance
 * ONCE (Clipper round offset on its exact contour — holes shrink), then each
 * allowed orientation of the grown shape is profiled on the band grid.
 * Orientations with identical profiles (symmetric letters) are dropped.
 */
export function buildRasterModel(instances: PartInstance[], opts: RasterModelOptions): RasterModel {
  const { usable } = opts;
  const h = opts.bandHeight ?? defaultBandHeight(usable);
  const bandCount = Math.max(0, Math.floor((usable.maxY - usable.minY) / h + 1e-9));
  const model: RasterModel = {
    h,
    y0: usable.minY,
    bandCount,
    xMin: usable.minX,
    xMax: usable.maxX,
    shapeCount: 0,
    byInstance: [],
    parts: [],
    remnants: [],
  };
  // Remnant obstacles: grown by the same clearance as a part, so the gap to an
  // earlier cut is the full spacing + kerf; profiled on the sheet's band grid.
  for (const rem of opts.remnants ?? []) {
    const base: Region = rem.blocked.filter((r) => r.length >= 3).map((outer) => ({ outer, holes: [] }));
    const grown = base.length ? offsetRegionClipper(base, opts.clearance + ARC_TOL_MM, ARC_TOL_MM) : [];
    let top = Infinity;
    for (const c of grown) for (const p of c.outer) if (p.y < top) top = p.y;
    if (!grown.length || !Number.isFinite(top)) {
      model.remnants.push(null);
      continue;
    }
    const k = Math.floor((top - usable.minY) / h);
    const prof = bandProfile(grown, h, usable.minY + k * h);
    model.remnants.push(prof ? { prof, k } : null);
  }
  const seen = new Map<PreparedPart, RasterPartModel>();

  for (const inst of instances) {
    let pm = seen.get(inst.part);
    if (!pm) {
      pm = { part: inst.part, options: [] };
      seen.set(inst.part, pm);
      model.parts.push(pm);
      const raw = inst.part.contour;
      // Heavy rings (fine curve samples) are thinned for speed; the tolerance
      // is added back onto the growth, so the collision shape still contains
      // the exact part grown by the full clearance.
      let simplified = false;
      const light = (ring: Contour['outer']): Contour['outer'] => {
        if (ring.length <= 48) return ring;
        simplified = true;
        return simplifyRing(ring, SIMPLIFY_MM);
      };
      const base: Region = [
        { outer: light(raw.outer), holes: opts.holeFilling ? raw.holes.map(light) : [] },
      ];
      const grow = opts.clearance > 0 || simplified ? opts.clearance + (simplified ? SIMPLIFY_MM : 0) + ARC_TOL_MM : 0;
      const grown = grow > 0 ? offsetRegionClipper(base, grow, ARC_TOL_MM) : base;
      if (grown.length) {
        const keys = new Set<string>();
        for (const o of inst.part.rawOrientations()) {
          const region = transformRegion(grown, o.rotation, o.mirror);
          const prof = bandProfile(region, h);
          if (!prof) continue;
          if (prof.maxX - prof.minX > usable.maxX - usable.minX + 1e-9) continue;
          if (prof.rows > bandCount) continue;
          const key = profileKey(prof);
          if (keys.has(key)) continue;
          keys.add(key);
          const rawOriented = transformRegion([raw], o.rotation, o.mirror)[0]!;
          const outer = largestOuter(region);
          const shape: OrientedShape = {
            key: `${inst.part.id}#${o.rotation}${o.mirror ? 'M' : ''}`,
            partId: inst.part.id,
            rotation: o.rotation,
            mirror: o.mirror,
            outer,
            holes: rawOriented.holes,
            bounds: ringBounds(outer),
            rawOuter: rawOriented.outer,
            netArea: inst.part.netArea,
            perimeter: contourPerimeter(rawOriented),
          };
          pm.options.push({ id: model.shapeCount++, shape, prof });
        }
      }
      opts.onTick?.();
    }
    model.byInstance.push(pm);
  }
  return model;
}
