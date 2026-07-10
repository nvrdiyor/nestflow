/**
 * Core domain types for the NestFlow nesting engine.
 *
 * Units: all geometry is expressed in a single linear unit (typically mm). The
 * caller is responsible for converting from cm/inch/m before handing geometry
 * to the engine; {@link NestConfig.units} is metadata used only for reporting.
 *
 * Coordinate convention: the engine is agnostic to whether Y points up or down.
 * Winding is normalised internally where it matters (Minkowski/NFP), so callers
 * may supply rings in any orientation.
 */

/** A 2D point. */
export interface Point {
  x: number;
  y: number;
}

/**
 * An ordered list of vertices describing a simple polygon boundary.
 *
 * Rings are stored *open* (the last vertex is NOT a duplicate of the first).
 * A ring must contain at least 3 distinct vertices to enclose area.
 */
export type Ring = Point[];

/**
 * A single connected polygon with an outer boundary and zero or more holes.
 * Holes must lie inside {@link outer} and must not overlap one another.
 */
export interface Contour {
  outer: Ring;
  holes: Ring[];
}

/**
 * A polygonal region: a set of disjoint {@link Contour}s. Boolean operations and
 * NFP/IFP computations return regions because a single operation can yield
 * multiple disjoint pieces (e.g. subtracting an NFP can split free space).
 */
export type Region = Contour[];

/** An axis-aligned bounding box. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * A distinct part to be nested. A part may be requested in multiple copies via
 * {@link quantity}; each copy is an independent placeable instance.
 */
export interface Part {
  /** Stable identifier, unique within a nest job. */
  id: string;
  /** Geometry in engine units, expressed relative to the part's own origin. */
  contour: Contour;
  /** Number of identical copies to place. Defaults to 1. */
  quantity?: number;
  /**
   * Allowed rotation angles in degrees. If omitted, {@link NestConfig.rotations}
   * is used. Use this to model grain/direction-locked materials.
   */
  allowedRotations?: number[];
  /** If true, the part may be mirrored (flipped). Overrides the global flag. */
  allowMirror?: boolean;
  /** Optional label for reporting. */
  label?: string;
}

/** The stock sheet the parts are cut from. */
export interface SheetSpec {
  width: number;
  height: number;
  /** Safe margin kept clear on every edge (engine units). Defaults to 0. */
  margin?: number;
  /** Material cost of one sheet, used for costing. Defaults to 0. */
  cost?: number;
  /** Maximum number of sheets available. Defaults to Infinity. */
  quantity?: number;
}

/** Machine parameters used for cut-time and cost estimation. */
export interface MachineSpec {
  /** Cutting feed rate along contours, engine units per second. */
  cutSpeed: number;
  /** Rapid/travel speed between contours, engine units per second. */
  travelSpeed: number;
  /** Machine operating cost per hour, in the caller's currency. */
  hourlyRate: number;
  /** Fixed time added per contour start (pierce/plunge), seconds. Defaults to 0. */
  pierceTime?: number;
  /** Kerf (cut width) compensation, engine units. Defaults to {@link NestConfig.kerf}. */
  kerf?: number;
}

export type Strategy = 'fast' | 'balanced' | 'max';
export type Units = 'mm' | 'cm' | 'inch' | 'm';

/** Configuration for a nesting job. */
export interface NestConfig {
  sheet: SheetSpec;
  units: Units;
  /** Minimum gap enforced between any two parts (engine units). Defaults to 0. */
  spacing?: number;
  /** Cut width; each part is dilated by kerf/2 for collision. Defaults to 0. */
  kerf?: number;
  /** Default allowed rotations (degrees) when a part does not specify its own. */
  rotations?: number[];
  /** Allow mirrored placement globally. Defaults to false. */
  allowMirror?: boolean;
  /** Attempt to place small parts inside holes of larger parts. Defaults to true. */
  holeFilling?: boolean;
  /** Search intensity preset. Defaults to 'balanced'. */
  strategy?: Strategy;
  /** Deterministic seed for reproducible search. Defaults to a fixed value. */
  seed?: number;
  /** Wall-clock budget for search, milliseconds. Overrides strategy defaults. */
  timeLimitMs?: number;
  /** Machine parameters for costing. */
  machine?: MachineSpec;
  /** Progress callback invoked during search (0..1). */
  onProgress?: (fraction: number, best: number) => void;
}

/** The placement of a single part instance on a sheet. */
export interface Placement {
  partId: string;
  /** Zero-based index of the copy of this part (0..quantity-1). */
  instance: number;
  /** Zero-based sheet index. */
  sheet: number;
  /** Translation applied to the (rotated/mirrored) part's reference origin. */
  x: number;
  y: number;
  /** Applied rotation in degrees. */
  rotation: number;
  /** Whether the part was mirrored (flipped in X). */
  mirrored: boolean;
  /** If placed inside a hole, the owning placement's part id (for reporting). */
  insideHoleOf?: string;
}

/** A part instance that could not be placed within the available sheets. */
export interface UnplacedPart {
  partId: string;
  instance: number;
  reason: 'too-large' | 'no-space' | 'sheet-limit';
}

/** Quantitative results of a nest, suitable for reports and costing. */
export interface NestMetrics {
  /** Combined net area of all placed parts (holes subtracted). */
  usedArea: number;
  /** Total sheet area consumed (sheetsUsed * sheetArea). */
  totalSheetArea: number;
  /** usedArea / totalSheetArea, in [0, 1]. */
  utilization: number;
  /** 1 - utilization. */
  wastePercent: number;
  /** Area saved versus a naive bounding-box baseline. */
  savedArea: number;
  /** Number of sheets consumed. */
  sheetsUsed: number;
  /** Total contour length to be cut (outer + holes), including kerf passes. */
  totalCutLength: number;
  /** Estimated cutting time in seconds (cut + travel + pierce). */
  estimatedCutTimeSec: number;
  /** Estimated machine cost for the job. */
  estimatedMachineCost: number;
  /** Estimated material cost for the job. */
  estimatedMaterialCost: number;
  /** Money saved versus the naive baseline (fewer sheets). */
  savedMoney: number;
  /** Sheets a naive one-part-per-cell baseline would have required. */
  baselineSheets: number;
}

/** The complete outcome of a nest job. */
export interface NestResult {
  placements: Placement[];
  unplaced: UnplacedPart[];
  sheetsUsed: number;
  metrics: NestMetrics;
  /** Number of candidate layouts evaluated by the search. */
  iterations: number;
  elapsedMs: number;
  config: NestConfig;
}
