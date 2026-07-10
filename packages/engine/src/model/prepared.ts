import type { Bounds, Contour, NestConfig, Part, Ring } from '../types.js';
import {
  contourArea,
  contourPerimeter,
  mirrorContour,
  ringArea,
  ringBounds,
  rotateContour,
} from '../geometry/polygon.js';
import { dilateRing } from '../geometry/offset.js';

/**
 * A part fixed to a specific rotation and mirror state, with all geometry that
 * placement needs precomputed. Immutable and cacheable.
 *
 * `outer` is the *grown* outer boundary — the raw outline dilated by the
 * clearance (spacing/2 + kerf/2) — so that NFP/IFP collision tests using it
 * automatically enforce the requested gap between parts. `holes` and the metric
 * fields use the raw (un-grown) geometry.
 */
export interface OrientedShape {
  /** Unique key across (partId, rotation, mirror); drives NFP caching. */
  key: string;
  partId: string;
  rotation: number;
  mirror: boolean;
  /** Grown outer ring (dilated by clearance) in the part's oriented local frame. */
  outer: Ring;
  /** Raw holes (rotated/mirrored) for hole-filling. */
  holes: Ring[];
  /** Bounds of the grown outer ring. */
  bounds: Bounds;
  /** Raw (un-grown) oriented outer ring, for rendering and export. */
  rawOuter: Ring;
  /** Net area of the raw contour (holes subtracted). Orientation-invariant. */
  netArea: number;
  /** Perimeter of the raw contour (outer + holes). Orientation-invariant. */
  perimeter: number;
}

/**
 * Applies a part's orientation (mirror-then-rotate about the origin) to a raw
 * contour. This is the exact transform {@link PreparedPart.oriented} uses, exposed
 * for rendering and export so callers can reconstruct a placement's true geometry
 * from a {@link Part} and its {@link import('../types.js').Placement}.
 */
export function orientContour(contour: Contour, rotation: number, mirror: boolean): Contour {
  let c = contour;
  if (mirror) c = mirrorContour(c, 0);
  return rotateContour(c, rotation);
}

/** Picks the largest-area contour's outer ring from a dilation result. */
function largestOuter(region: { outer: Ring }[], fallback: Ring): Ring {
  if (region.length === 0) return fallback;
  let best = region[0]!.outer;
  let bestArea = ringArea(best);
  for (let i = 1; i < region.length; i++) {
    const a = ringArea(region[i]!.outer);
    if (a > bestArea) {
      bestArea = a;
      best = region[i]!.outer;
    }
  }
  return best;
}

/**
 * A part together with the derived data used during search: its clearance, the
 * list of (rotation, mirror) orientations to try, and a lazy per-orientation
 * cache of {@link OrientedShape}s.
 */
export class PreparedPart {
  readonly id: string;
  readonly label: string | undefined;
  readonly quantity: number;
  readonly rotations: number[];
  readonly mirror: boolean;
  readonly netArea: number;
  private readonly baseContour: Contour;
  private readonly clearance: number;
  private readonly cache = new Map<string, OrientedShape>();

  constructor(part: Part, config: NestConfig) {
    this.id = part.id;
    this.label = part.label;
    this.quantity = Math.max(1, part.quantity ?? 1);
    this.baseContour = part.contour;
    const spacing = config.spacing ?? 0;
    const kerf = config.kerf ?? 0;
    this.clearance = spacing / 2 + kerf / 2;
    this.mirror = part.allowMirror ?? config.allowMirror ?? false;
    const rotations = part.allowedRotations ?? config.rotations ?? [0];
    // De-duplicate and normalise to [0, 360).
    const seen = new Set<number>();
    this.rotations = [];
    for (const r of rotations) {
      const norm = ((r % 360) + 360) % 360;
      const q = Math.round(norm * 1e6) / 1e6;
      if (!seen.has(q)) {
        seen.add(q);
        this.rotations.push(norm);
      }
    }
    if (this.rotations.length === 0) this.rotations = [0];
    this.netArea = contourArea(part.contour);
  }

  /** All (rotationIndex, mirror) orientation options for this part. */
  orientationOptions(): Array<{ rotation: number; mirror: boolean }> {
    const options: Array<{ rotation: number; mirror: boolean }> = [];
    for (const rotation of this.rotations) {
      options.push({ rotation, mirror: false });
      if (this.mirror) options.push({ rotation, mirror: true });
    }
    return options;
  }

  /** Returns (and memoises) the oriented shape for the given rotation/mirror. */
  oriented(rotation: number, mirror: boolean): OrientedShape {
    const key = `${this.id}#${rotation}${mirror ? 'M' : ''}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    let contour = this.baseContour;
    if (mirror) contour = mirrorContour(contour, 0);
    contour = rotateContour(contour, rotation);

    const rawOuter = contour.outer;
    const grown =
      this.clearance > 0
        ? largestOuter(dilateRing(rawOuter, this.clearance), rawOuter)
        : rawOuter.map((p) => ({ x: p.x, y: p.y }));

    const shape: OrientedShape = {
      key,
      partId: this.id,
      rotation,
      mirror,
      outer: grown,
      holes: contour.holes,
      bounds: ringBounds(grown),
      rawOuter,
      netArea: this.netArea,
      perimeter: contourPerimeter(contour),
    };
    this.cache.set(key, shape);
    return shape;
  }
}

/** A single placeable copy of a part. */
export interface PartInstance {
  part: PreparedPart;
  /** 0-based copy index within the part's quantity. */
  instance: number;
}

/** Expands parts (respecting quantity) into a flat list of placeable instances. */
export function prepareInstances(parts: Part[], config: NestConfig): PartInstance[] {
  const instances: PartInstance[] = [];
  for (const part of parts) {
    const prepared = new PreparedPart(part, config);
    for (let i = 0; i < prepared.quantity; i++) {
      instances.push({ part: prepared, instance: i });
    }
  }
  return instances;
}
