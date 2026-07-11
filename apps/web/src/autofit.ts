import { placementContour, ringBounds, type NestResult, type Part } from '@nestflow/engine';

/**
 * Estimates a square sheet generous enough to hold the parts on a single sheet
 * (used in "fit sheet to parts" mode so the nester clusters everything, then we
 * crop the sheet to the packed bounding box).
 */
export function estimateSheet(parts: Part[]): { width: number; height: number } {
  let sum = 0;
  for (const p of parts) {
    const b = ringBounds(p.contour.outer);
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    sum += w * h * (p.quantity ?? 1);
  }
  const side = Math.max(50, Math.ceil(Math.sqrt(Math.max(1, sum)) * 2.2));
  return { width: side, height: side };
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
