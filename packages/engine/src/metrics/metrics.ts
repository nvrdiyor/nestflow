import type { NestConfig, NestMetrics } from '../types.js';
import type { GreedyResult, PlacedItem } from '../placement/index.js';
import { ringBounds, ringCentroid } from '../geometry/polygon.js';

/** Usable sheet dimensions after subtracting the safe margin on all sides. */
function usableSize(config: NestConfig): { w: number; h: number } {
  const margin = config.sheet.margin ?? 0;
  return {
    w: Math.max(0, config.sheet.width - 2 * margin),
    h: Math.max(0, config.sheet.height - 2 * margin),
  };
}

/**
 * Estimates how many sheets a naive rectangular nester (next-fit-decreasing
 * shelf packing on axis-aligned bounding boxes) would need. This is the baseline
 * the irregular nester is compared against to quantify savings.
 *
 * Each box is oriented to whichever of its two 90° orientations fits the sheet
 * (preferring the longer side vertical for tidy shelves), so a part that fits
 * only when rotated is not misclassified. Sheets are opened lazily, avoiding the
 * off-by-one that a pre-counted first sheet would introduce.
 */
export function baselineSheetCount(items: PlacedItem[], config: NestConfig): number {
  const { w: usableW, h: usableH } = usableSize(config);
  if (usableW <= 0 || usableH <= 0) return items.length;
  const eps = 1e-6;

  const oriented = items
    .map((it) => {
      const b = ringBounds(it.shape.rawOuter);
      const w = b.maxX - b.minX;
      const h = b.maxY - b.minY;
      const fitsAsIs = w <= usableW + eps && h <= usableH + eps;
      const fitsRot = h <= usableW + eps && w <= usableH + eps;
      if (fitsAsIs && fitsRot) {
        const longer = Math.max(w, h);
        const shorter = Math.min(w, h);
        return longer <= usableH + eps
          ? { w: shorter, h: longer, fits: true }
          : { w: longer, h: shorter, fits: true };
      }
      if (fitsAsIs) return { w, h, fits: true };
      if (fitsRot) return { w: h, h: w, fits: true };
      return { w, h, fits: false };
    })
    .sort((a, b) => b.h - a.h);

  let sheets = 0;
  let x = 0;
  let y = 0;
  let shelfH = 0;
  let sheetOpen = false;
  const openSheet = (): void => {
    sheets++;
    x = 0;
    y = 0;
    shelfH = 0;
    sheetOpen = true;
  };

  for (const box of oriented) {
    if (!box.fits) {
      // Cannot be cut from the sheet in any orientation: a dedicated sheet, and
      // subsequent parts must start on a fresh one.
      openSheet();
      sheetOpen = false;
      continue;
    }
    if (!sheetOpen) openSheet();
    if (x + box.w > usableW + eps) {
      // Next shelf up.
      x = 0;
      y += shelfH;
      shelfH = 0;
    }
    if (y + box.h > usableH + eps) {
      // Overflowed the sheet: open a new one.
      openSheet();
    }
    x += box.w;
    shelfH = Math.max(shelfH, box.h);
  }
  return sheets;
}

/**
 * Computes utilization, waste, cut-length, time, and cost metrics for a nest.
 * Cut time combines contour cutting, per-contour pierce time, and an approximate
 * rapid-travel estimate between parts.
 */
export function computeMetrics(result: GreedyResult, config: NestConfig): NestMetrics {
  const sheetsUsed = result.sheets.length;
  const sheetArea = config.sheet.width * config.sheet.height;
  const totalSheetArea = sheetsUsed * sheetArea;

  let usedArea = 0;
  let totalCutLength = 0;
  let contourCount = 0;
  let bboxAreaSum = 0;
  const allItems: PlacedItem[] = [];

  for (const sheet of result.sheets) {
    for (const item of sheet.items) {
      allItems.push(item);
      usedArea += item.shape.netArea;
      totalCutLength += item.shape.perimeter;
      contourCount += 1 + item.shape.holes.length;
      const b = ringBounds(item.shape.rawOuter);
      bboxAreaSum += (b.maxX - b.minX) * (b.maxY - b.minY);
    }
  }

  const machine = config.machine;
  const cutSpeed = machine?.cutSpeed ?? 0;
  const travelSpeed = machine?.travelSpeed ?? 0;
  const pierceTime = machine?.pierceTime ?? 0;

  // Approximate rapid travel: sum of centroid-to-centroid distance in the order
  // parts were placed, per sheet, starting from the sheet origin.
  let travelLength = 0;
  for (const sheet of result.sheets) {
    let prev = { x: 0, y: 0 };
    for (const item of sheet.items) {
      const c = ringCentroid(item.shape.rawOuter);
      const world = { x: c.x + item.x, y: c.y + item.y };
      travelLength += Math.hypot(world.x - prev.x, world.y - prev.y);
      prev = world;
    }
  }

  const cutTime = cutSpeed > 0 ? totalCutLength / cutSpeed : 0;
  const travelTime = travelSpeed > 0 ? travelLength / travelSpeed : 0;
  const estimatedCutTimeSec = cutTime + travelTime + contourCount * pierceTime;
  const estimatedMachineCost = machine ? (estimatedCutTimeSec / 3600) * machine.hourlyRate : 0;

  const sheetCost = config.sheet.cost ?? 0;
  const estimatedMaterialCost = sheetsUsed * sheetCost;

  const baselineSheets = baselineSheetCount(allItems, config);
  const savedSheets = Math.max(0, baselineSheets - sheetsUsed);
  const savedArea = savedSheets * sheetArea;
  const savedMoney = savedSheets * sheetCost;

  const utilization = totalSheetArea > 0 ? usedArea / totalSheetArea : 0;

  return {
    usedArea,
    totalSheetArea,
    utilization,
    wastePercent: 1 - utilization,
    savedArea,
    sheetsUsed,
    totalCutLength,
    estimatedCutTimeSec,
    estimatedMachineCost,
    estimatedMaterialCost,
    savedMoney,
    baselineSheets,
  };
}
