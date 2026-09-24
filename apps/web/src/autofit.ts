import { placementContour, ringBounds, type NestResult, type Part } from '@nestflow/engine';

/**
 * Estimates a sheet generous enough to hold the parts on a single sheet (used
 * in "fit sheet to parts" mode, then the sheet is cropped to the pack). The
 * nester fills full-width rows from the top, so the width is set near the
 * square root of the parts' area and the height left generous — the cropped
 * result comes out roughly square instead of one long thin strip.
 */
export function estimateSheet(parts: Part[]): { width: number; height: number } {
  let sum = 0;
  let maxDim = 0;
  for (const p of parts) {
    const b = ringBounds(p.contour.outer);
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    sum += w * h * (p.quantity ?? 1);
    maxDim = Math.max(maxDim, w, h);
  }
  const root = Math.sqrt(Math.max(1, sum));
  const width = Math.max(50, Math.ceil(Math.max(maxDim * 1.05 + 10, root * 1.25)));
  const height = Math.max(50, Math.ceil(Math.max(maxDim * 1.05 + 10, (sum * 3) / width)));
  return { width, height };
}

/**
 * Crops a single-sheet result to the tight bounding box of the placed parts:
 * shifts every placement so the pack sits at (margin, margin) and resizes the
 * sheet to fit — turning a tiny cluster on a huge sheet into a clean, full-looking
 * layout with a realistic utilization figure. No-ops for multi-sheet results.
 */
export function fitToParts(result: NestResult, parts: Part[], margin: number): NestResult {
  if (result.sheetsUsed !== 1 || result.placements.length === 0) return result;
  const map = new Map(parts.map((p) => [p.id, p]));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pl of result.placements) {
    const part = map.get(pl.partId);
    if (!part) continue;
    const b = ringBounds(placementContour(part, pl).outer);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  if (!Number.isFinite(minX)) return result;

  const bw = maxX - minX;
  const bh = maxY - minY;
  const dx = margin - minX;
  const dy = margin - minY;
  const placements = result.placements.map((pl) => ({ ...pl, x: pl.x + dx, y: pl.y + dy }));

  const width = Math.max(1, bw + 2 * margin);
  const height = Math.max(1, bh + 2 * margin);
  const sheetArea = width * height;
  const usedArea = result.metrics.usedArea;
  const utilization = sheetArea > 0 ? Math.min(1, usedArea / sheetArea) : 0;

  return {
    ...result,
    placements,
    sheetsUsed: 1,
    config: { ...result.config, sheet: { ...result.config.sheet, width, height } },
    metrics: {
      ...result.metrics,
      totalSheetArea: sheetArea,
      utilization,
      wastePercent: 1 - utilization,
    },
  };
}
