import type { Bounds } from '../types.js';
import type { OrientedShape } from '../model/prepared.js';

/** A part instance fixed at a world position on a sheet. */
export interface PlacedItem {
  shape: OrientedShape;
  /** Translation applied to the oriented shape's local origin. */
  x: number;
  y: number;
  partId: string;
  instance: number;
  /** Part id of the owner whose hole this item sits inside, if any. */
  insideHoleOf?: string;
}

/** The contents of a single sheet during placement. */
export interface SheetLayout {
  items: PlacedItem[];
  /** Running union of placed raw-part bounds (null while empty). */
  bounds: Bounds | null;
}

/** How candidate positions are scored during placement. */
export type PackObjective = 'bounding-box' | 'bottom-left';
