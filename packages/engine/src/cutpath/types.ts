import type { Point, Ring } from '../types.js';

/** One placed part's world geometry, as a unit to be cut. */
export interface CutContour {
  partId: string;
  instance: number;
  sheet: number;
  /** Outer ring first, then holes — all in world (sheet) coordinates. */
  rings: Ring[];
  /** Lead-in point (lowest-then-leftmost outer vertex); used for travel routing. */
  start: Point;
  /** Total contour length (outer + holes). */
  perimeter: number;
}

/** A straight run shared by two adjacent parts that can be cut once, not twice. */
export interface CommonLine {
  a: Point;
  b: Point;
  length: number;
  partA: string;
  partB: string;
}

/** An optimised cutting plan for a single sheet. */
export interface CutPlan {
  sheet: number;
  contours: CutContour[];
  /** Indices into `contours`, in the order they should be cut. */
  order: number[];
  commonLines: CommonLine[];
  /** Sum of all contour perimeters. */
  cutLength: number;
  /** Total length of shared runs (cut once instead of twice). */
  commonLength: number;
  /** Rapid-travel distance between contours along the optimised order. */
  travelLength: number;
}

/** Aggregate cut metrics across all sheets, with common-line savings. */
export interface CutMetrics {
  cutLength: number;
  commonLength: number;
  /** cutLength − commonLength: the real distance the tool cuts. */
  effectiveCutLength: number;
  travelLength: number;
  estimatedCutTimeSec: number;
  /** Cut length and time saved by common-line cutting versus cutting every edge. */
  savedLength: number;
  savedTimeSec: number;
}
