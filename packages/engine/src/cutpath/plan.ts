import type { NestConfig, NestResult, Part, Ring } from '../types.js';
import { ringPerimeter } from '../geometry/polygon.js';
import { placementContour } from '../render/svg.js';
import { detectCommonLines, leadInPoint } from './commonLines.js';
import { optimizeOrder } from './sequence.js';
import type { CutContour, CutMetrics, CutPlan } from './types.js';

export interface CutPathOptions {
  /** Ignore straight edges / overlaps shorter than this. Default 8. */
  minLength?: number;
  /** Max angle between edges to treat as parallel, radians. Default 2°. */
  angleTol?: number;
  /** Override the max perpendicular gap for a common line. */
  maxGap?: number;
}

/**
 * Builds an optimised cutting plan per sheet from a nest result: reconstructs
 * each part's world geometry, finds common lines between adjacent parts, and
 * orders the contours to minimise rapid travel.
 */
export function planCutPath(result: NestResult, parts: Part[], options: CutPathOptions = {}): CutPlan[] {
  const partMap = new Map(parts.map((p) => [p.id, p]));
  const spacing = result.config.spacing ?? 0;
  const kerf = result.config.kerf ?? 0;
  const maxGap = options.maxGap ?? Math.max(spacing + kerf, 0.5) * 1.6 + 0.5;
  const minLength = options.minLength ?? 8;
  const angleTol = options.angleTol ?? (2 * Math.PI) / 180;

  const bySheet = new Map<number, CutContour[]>();
  for (const pl of result.placements) {
    const part = partMap.get(pl.partId);
    if (!part) continue;
    const contour = placementContour(part, pl);
    const rings: Ring[] = [contour.outer, ...contour.holes];
    let perimeter = 0;
    for (const r of rings) perimeter += ringPerimeter(r);
    const cc: CutContour = {
      partId: pl.partId,
      instance: pl.instance,
      sheet: pl.sheet,
      rings,
      start: leadInPoint(contour.outer),
      perimeter,
    };
    const arr = bySheet.get(pl.sheet);
    if (arr) arr.push(cc);
    else bySheet.set(pl.sheet, [cc]);
  }

  const plans: CutPlan[] = [];
  for (const [sheet, contours] of [...bySheet.entries()].sort((a, b) => a[0] - b[0])) {
    const { order, travel } = optimizeOrder(
      contours.map((c) => c.start),
      { x: 0, y: 0 },
    );
    const commonLines = detectCommonLines(contours, { maxGap, minLength, angleTol });
    let commonLength = 0;
    for (const cl of commonLines) commonLength += cl.length;
    let cutLength = 0;
    for (const c of contours) cutLength += c.perimeter;
    plans.push({ sheet, contours, order, commonLines, cutLength, commonLength, travelLength: travel });
  }
  return plans;
}

/** Aggregates cut metrics (with common-line savings) across all sheet plans. */
export function cutMetrics(plans: CutPlan[], config: NestConfig): CutMetrics {
  let cutLength = 0;
  let commonLength = 0;
  let travelLength = 0;
  let contourCount = 0;
  for (const p of plans) {
    cutLength += p.cutLength;
    commonLength += p.commonLength;
    travelLength += p.travelLength;
    for (const c of p.contours) contourCount += c.rings.length;
  }
  const effectiveCutLength = Math.max(0, cutLength - commonLength);

  const machine = config.machine;
  const cutSpeed = machine?.cutSpeed ?? 0;
  const travelSpeed = machine?.travelSpeed ?? 0;
  const pierceTime = machine?.pierceTime ?? 0;
  const cutTime = cutSpeed > 0 ? effectiveCutLength / cutSpeed : 0;
  const travelTime = travelSpeed > 0 ? travelLength / travelSpeed : 0;
  const estimatedCutTimeSec = cutTime + travelTime + contourCount * pierceTime;
  const savedTimeSec = cutSpeed > 0 ? commonLength / cutSpeed : 0;

  return {
    cutLength,
    commonLength,
    effectiveCutLength,
    travelLength,
    estimatedCutTimeSec,
    savedLength: commonLength,
    savedTimeSec,
  };
}
