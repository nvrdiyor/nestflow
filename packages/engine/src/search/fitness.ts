import type { GreedyResult } from '../placement/index.js';

/** Weight of a single unplaced part — dominates everything else. */
const W_UNPLACED = 1e6;
/** Weight of one consumed sheet — the primary objective is fewer sheets. */
const W_SHEET = 1e3;
/** Weight of the LAST sheet's fill fraction — the drain gradient. */
const W_DRAIN = 50;

/**
 * Scores a layout; lower is better. The objective is lexicographic in practice:
 *   1. minimise unplaced parts,
 *   2. then minimise sheets used,
 *   3. then DRAIN the last sheet: its part-area fraction is penalised, so
 *      moving any single part off the final sheet improves fitness. Without
 *      this term a "3 letters spilled onto sheet 2" layout scores the same as
 *      "30 spilled" and the search has no gradient toward clearing the spill.
 *   4. then maximise compaction of the earlier sheets.
 */
export function fitnessOf(result: GreedyResult, sheetArea: number): number {
  const unplaced = result.unplaced.length;
  const sheetsUsed = result.sheets.length;
  let boundSum = 0;
  for (const sheet of result.sheets) {
    if (sheet.bounds) {
      boundSum += (sheet.bounds.maxX - sheet.bounds.minX) * (sheet.bounds.maxY - sheet.bounds.minY);
    }
  }
  const compaction = sheetArea > 0 ? boundSum / sheetArea : 0;
  let drain = 0;
  if (sheetsUsed > 1 && sheetArea > 0) {
    const last = result.sheets[sheetsUsed - 1];
    let lastArea = 0;
    for (const item of last?.items ?? []) lastArea += item.shape.netArea;
    drain = lastArea / sheetArea;
  }
  return unplaced * W_UNPLACED + sheetsUsed * W_SHEET + drain * W_DRAIN + compaction;
}
