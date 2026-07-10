import type { GreedyResult } from '../placement/index.js';

/** Weight of a single unplaced part — dominates everything else. */
const W_UNPLACED = 1e6;
/** Weight of one consumed sheet — the primary objective is fewer sheets. */
const W_SHEET = 1e3;

/**
 * Scores a layout; lower is better. The objective is lexicographic in practice:
 *   1. minimise unplaced parts,
 *   2. then minimise sheets used,
 *   3. then maximise compaction (minimise the combined part bounding area,
 *      normalised by sheet area) so the final sheet is left as empty as possible.
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
  return unplaced * W_UNPLACED + sheetsUsed * W_SHEET + compaction;
}
