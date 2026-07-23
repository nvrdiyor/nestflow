import type { Bounds, Placement, UnplacedPart } from '../types.js';
import type { OrientedShape, PartInstance } from '../model/prepared.js';
import type { NfpCache } from '../nfp/cache.js';
import type { PackObjective, PlacedItem, SheetLayout } from './types.js';
import { innerFitRect, innerFitRectBounds } from '../nfp/ifp.js';
import { pointInRing, ringCentroid, translateRing } from '../geometry/polygon.js';
import { feasibleRegion, chooseReference, type Candidate } from './region.js';

/** Per-instance orientation choice; `null` means "try every orientation". */
export type OrientationOf = (instanceIndex: number) => { rotation: number; mirror: boolean } | null;

export interface GreedyOptions {
  usable: Bounds;
  sheetLimit: number;
  holeFilling: boolean;
  objective: PackObjective;
  cache: NfpCache;
}

export interface GreedyResult {
  sheets: SheetLayout[];
  placements: Placement[];
  unplaced: UnplacedPart[];
}

function orientationsFor(
  inst: PartInstance,
  chosen: { rotation: number; mirror: boolean } | null,
): Array<{ rotation: number; mirror: boolean }> {
  return chosen ? [chosen] : inst.part.orientationOptions();
}

/** Detects whether a placed part sits inside a hole of an existing part. */
function detectHoleOwner(shape: OrientedShape, x: number, y: number, placed: PlacedItem[]): string | undefined {
  const c = ringCentroid(shape.rawOuter);
  const world = { x: c.x + x, y: c.y + y };
  for (const item of placed) {
    for (const hole of item.shape.holes) {
      if (pointInRing(world, translateRing(hole, item.x, item.y))) return item.partId;
    }
  }
  return undefined;
}

function commit(
  sheet: SheetLayout,
  sheetIndex: number,
  shape: OrientedShape,
  cand: Candidate,
  inst: PartInstance,
  result: GreedyResult,
): void {
  const insideHoleOf = detectHoleOwner(shape, cand.x, cand.y, sheet.items);
  const item: PlacedItem = {
    shape,
    x: cand.x,
    y: cand.y,
    partId: inst.part.id,
    instance: inst.instance,
    ...(insideHoleOf ? { insideHoleOf } : {}),
  };
  sheet.items.push(item);

  const wminx = cand.x + shape.bounds.minX;
  const wminy = cand.y + shape.bounds.minY;
  const wmaxx = cand.x + shape.bounds.maxX;
  const wmaxy = cand.y + shape.bounds.maxY;
  sheet.bounds = sheet.bounds
    ? {
        minX: Math.min(sheet.bounds.minX, wminx),
        minY: Math.min(sheet.bounds.minY, wminy),
        maxX: Math.max(sheet.bounds.maxX, wmaxx),
        maxY: Math.max(sheet.bounds.maxY, wmaxy),
      }
    : { minX: wminx, minY: wminy, maxX: wmaxx, maxY: wmaxy };

  result.placements.push({
    partId: inst.part.id,
    instance: inst.instance,
    sheet: sheetIndex,
    x: cand.x,
    y: cand.y,
    rotation: shape.rotation,
    mirrored: shape.mirror,
    ...(insideHoleOf ? { insideHoleOf } : {}),
  });
}

/**
 * Places every instance following `order`, filling existing sheets first
 * (first-fit) and opening new sheets as needed. For each instance the best
 * orientation/position on the earliest sheet that can host it is chosen using
 * the configured objective. Deterministic given its inputs.
 */
/**
 * Post-search rescue: tries to move the (few) parts stranded on the LAST sheet
 * back onto earlier sheets. The greedy pass places parts in chromosome order,
 * so a single awkward part can open a whole extra sheet even when a pocket for
 * it exists earlier — exactly the "one lonely letter on sheet 2" case.
 */
export function reinsertLastSheet(result: GreedyResult, opts: GreedyOptions): void {
  const sheets = result.sheets;
  if (sheets.length < 2) return;
  const lastIndex = sheets.length - 1;
  const last = sheets[lastIndex] as SheetLayout;
  if (last.items.length === 0 || last.items.length > 6) return;

  for (const item of [...last.items]) {
    let targetSheet = -1;
    let cand: Candidate | null = null;
    for (let s = 0; s < lastIndex; s++) {
      const sheet = sheets[s] as SheetLayout;
      const region = feasibleRegion(opts.usable, sheet.items, item.shape, opts.cache, opts.holeFilling);
      const c = chooseReference(region, sheet.bounds, item.shape, opts.usable, opts.objective);
      if (c) {
        targetSheet = s;
        cand = c;
        break;
      }
    }
    if (targetSheet < 0 || !cand) continue;
    last.items.splice(last.items.indexOf(item), 1);
    const sheet = sheets[targetSheet] as SheetLayout;
    item.x = cand.x;
    item.y = cand.y;
    delete item.insideHoleOf;
    const owner = detectHoleOwner(item.shape, cand.x, cand.y, sheet.items);
    if (owner) item.insideHoleOf = owner;
    sheet.items.push(item);
    const b = item.shape.bounds;
    const wb = { minX: cand.x + b.minX, minY: cand.y + b.minY, maxX: cand.x + b.maxX, maxY: cand.y + b.maxY };
    sheet.bounds = sheet.bounds
      ? {
          minX: Math.min(sheet.bounds.minX, wb.minX),
          minY: Math.min(sheet.bounds.minY, wb.minY),
          maxX: Math.max(sheet.bounds.maxX, wb.maxX),
          maxY: Math.max(sheet.bounds.maxY, wb.maxY),
        }
      : wb;
    const pl = result.placements.find(
      (q) => q.partId === item.partId && q.instance === item.instance && q.sheet === lastIndex,
    );
    if (pl) {
      pl.sheet = targetSheet;
      pl.x = cand.x;
      pl.y = cand.y;
      delete pl.insideHoleOf;
      if (item.insideHoleOf) pl.insideHoleOf = item.insideHoleOf;
    }
  }
  if (last.items.length === 0) sheets.pop();
}

export function greedyPlace(
  instances: PartInstance[],
  order: number[],
  orientationOf: OrientationOf,
  opts: GreedyOptions,
): GreedyResult {
  const { usable, sheetLimit, holeFilling, objective, cache } = opts;
  const sheets: SheetLayout[] = [];
  const result: GreedyResult = { sheets, placements: [], unplaced: [] };

  for (const idx of order) {
    const inst = instances[idx];
    if (!inst) continue;
    const orientations = orientationsFor(inst, orientationOf(idx));

    // Keep only orientations that could fit on an empty sheet at all.
    const fitting = orientations.filter((o) =>
      innerFitRectBounds(usable, inst.part.oriented(o.rotation, o.mirror).outer),
    );
    if (fitting.length === 0) {
      result.unplaced.push({ partId: inst.part.id, instance: inst.instance, reason: 'too-large' });
      continue;
    }

    let placed = false;
    for (let s = 0; s < sheets.length && !placed; s++) {
      const sheet = sheets[s] as SheetLayout;
      let bestShape: OrientedShape | null = null;
      let bestCand: Candidate | null = null;
      for (const o of fitting) {
        const shape = inst.part.oriented(o.rotation, o.mirror);
        const region = feasibleRegion(usable, sheet.items, shape, cache, holeFilling);
        const cand = chooseReference(region, sheet.bounds, shape, usable, objective);
        if (cand && (!bestCand || cand.score < bestCand.score)) {
          bestCand = cand;
          bestShape = shape;
        }
      }
      if (bestCand && bestShape) {
        commit(sheet, s, bestShape, bestCand, inst, result);
        placed = true;
      }
    }

    if (!placed) {
      if (sheets.length >= sheetLimit) {
        result.unplaced.push({ partId: inst.part.id, instance: inst.instance, reason: 'sheet-limit' });
        continue;
      }
      // Open a fresh sheet and place at the best empty-sheet position.
      let bestShape: OrientedShape | null = null;
      let bestCand: Candidate | null = null;
      for (const o of fitting) {
        const shape = inst.part.oriented(o.rotation, o.mirror);
        const region = innerFitRect(usable, shape.outer);
        const cand = chooseReference(region, null, shape, usable, objective);
        if (cand && (!bestCand || cand.score < bestCand.score)) {
          bestCand = cand;
          bestShape = shape;
        }
      }
      if (bestCand && bestShape) {
        const sheet: SheetLayout = { items: [], bounds: null };
        sheets.push(sheet);
        commit(sheet, sheets.length - 1, bestShape, bestCand, inst, result);
      } else {
        result.unplaced.push({ partId: inst.part.id, instance: inst.instance, reason: 'no-space' });
      }
    }
  }

  return result;
}
