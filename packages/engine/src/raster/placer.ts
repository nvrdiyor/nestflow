import type { Placement, UnplacedPart } from '../types.js';
import type { PartInstance } from '../model/prepared.js';
import type { GreedyResult } from '../placement/greedy.js';
import type { PlacedItem, SheetLayout } from '../placement/types.js';
import { BandSheet } from './sheet.js';
import type { RasterModel, RasterShape } from './model.js';

export interface RasterPlaceOptions {
  sheetLimit: number;
  /**
   * Placement gravity: a candidate's primary key is (top band + alpha·rows).
   * 0 = classic bottom-left (lowest top edge of the part's slot first), 1 =
   * lowest far edge, 0.5 = lowest centre. Ties go to the leftmost position.
   */
  alpha: number;
  /** Only the last N sheets accept new parts (Infinity = true first-fit). */
  openSheets?: number;
  /** Per-instance orientation restriction (index into the part's options), or -1 for free choice. */
  orientation?: Int32Array;
  onTick?: () => void;
  /** Polled every few placements; returning true abandons the pass (result null). */
  abort?: () => boolean;
}

interface SheetState {
  grid: BandSheet;
  layout: SheetLayout;
  /** Per shape id: lowest band that may still be feasible (monotone as the sheet fills). */
  resumeK: Int32Array;
  /** Per shape id: at band resumeK, the lowest tx that may still be feasible. */
  resumeTx: Float64Array;
}

interface Choice {
  opt: RasterShape;
  k: number;
  tx: number;
  p1: number;
  p2: number;
}

/**
 * Constructive bottom-left-fill on the band grid. Instances are placed in
 * `order`; each goes to the FIRST sheet that can host it (first-fit), at the
 * best position over all its allowed orientations. Positions are exact
 * contacts: the part is pushed to the lowest band where it fits, then as far
 * left as it goes — letters slide into each other's concavities and counters.
 */
export function rasterPlace(
  model: RasterModel,
  instances: PartInstance[],
  order: ArrayLike<number>,
  opts: RasterPlaceOptions,
): GreedyResult | null {
  const sheets: SheetState[] = [];
  const result: GreedyResult = { sheets: [], placements: [], unplaced: [] };
  const eps = 1e-9;
  let sinceCheck = 0;

  const newSheet = (): SheetState => {
    const st: SheetState = {
      grid: new BandSheet(model.bandCount, model.xMin, model.xMax),
      layout: { items: [], bounds: null },
      resumeK: new Int32Array(model.shapeCount),
      resumeTx: new Float64Array(model.shapeCount).fill(Number.NEGATIVE_INFINITY),
    };
    sheets.push(st);
    result.sheets.push(st.layout);
    return st;
  };

  const bestOn = (st: SheetState, options: RasterShape[]): Choice | null => {
    let best: Choice | null = null;
    for (const opt of options) {
      const p = opt.prof;
      const kMax = model.bandCount - p.rows;
      const txLo = model.xMin - p.minX;
      const txHi = model.xMax - p.maxX;
      const bias = opts.alpha * p.rows;
      const k0 = st.resumeK[opt.id]!;
      let k = k0;
      let found = Number.NaN;
      for (; k <= kMax; k++) {
        k = st.grid.nextCandidateBand(p, k);
        if (k > kMax) {
          k = kMax + 1;
          break;
        }
        if (best && k + bias > best.p1 + eps) break;
        const lo = k === k0 ? Math.max(txLo, st.resumeTx[opt.id]!) : txLo;
        const tx = st.grid.fitX(p, k, lo, txHi);
        if (!Number.isNaN(tx)) {
          found = tx;
          break;
        }
      }
      st.resumeK[opt.id] = k;
      st.resumeTx[opt.id] = Number.isNaN(found) ? Number.NEGATIVE_INFINITY : found;
      if (Number.isNaN(found)) continue;
      const p1 = k + bias;
      const p2 = found + p.minX;
      if (!best || p1 < best.p1 - eps || (Math.abs(p1 - best.p1) <= eps && p2 < best.p2 - eps)) {
        best = { opt, k, tx: found, p1, p2 };
      }
    }
    return best;
  };

  const commit = (sheetIndex: number, st: SheetState, c: Choice, inst: PartInstance): void => {
    const p = c.opt.prof;
    st.grid.insert(p, c.k, c.tx);
    const x = c.tx;
    const y = model.y0 + c.k * model.h - p.minY;
    const shape = c.opt.shape;
    const item: PlacedItem = { shape, x, y, partId: inst.part.id, instance: inst.instance };
    st.layout.items.push(item);
    const b = shape.bounds;
    const wb = { minX: x + b.minX, minY: y + b.minY, maxX: x + b.maxX, maxY: y + b.maxY };
    const sb = st.layout.bounds;
    st.layout.bounds = sb
      ? {
          minX: Math.min(sb.minX, wb.minX),
          minY: Math.min(sb.minY, wb.minY),
          maxX: Math.max(sb.maxX, wb.maxX),
          maxY: Math.max(sb.maxY, wb.maxY),
        }
      : wb;
    const pl: Placement = {
      partId: inst.part.id,
      instance: inst.instance,
      sheet: sheetIndex,
      x,
      y,
      rotation: shape.rotation,
      mirrored: shape.mirror,
    };
    result.placements.push(pl);
  };

  for (let n = 0; n < order.length; n++) {
    const idx = order[n]!;
    const inst = instances[idx];
    if (!inst) continue;
    const pm = model.byInstance[idx]!;
    let options = pm.options;
    const forced = opts.orientation ? opts.orientation[idx]! : -1;
    if (forced >= 0 && options.length > 1) options = [options[forced % options.length]!];
    if (options.length === 0) {
      const u: UnplacedPart = { partId: inst.part.id, instance: inst.instance, reason: 'too-large' };
      result.unplaced.push(u);
      continue;
    }

    let placed = false;
    const firstOpen = Math.max(0, sheets.length - (opts.openSheets ?? Number.POSITIVE_INFINITY));
    for (let s = firstOpen; s < sheets.length && !placed; s++) {
      const st = sheets[s]!;
      const c = bestOn(st, options);
      if (c) {
        commit(s, st, c, inst);
        placed = true;
      }
    }
    if (!placed) {
      if (sheets.length >= opts.sheetLimit) {
        result.unplaced.push({ partId: inst.part.id, instance: inst.instance, reason: 'sheet-limit' });
      } else {
        const st = newSheet();
        const c = bestOn(st, options);
        if (c) {
          commit(sheets.length - 1, st, c, inst);
        } else {
          sheets.pop();
          result.sheets.pop();
          result.unplaced.push({ partId: inst.part.id, instance: inst.instance, reason: 'no-space' });
        }
      }
    }

    opts.onTick?.();
    if (opts.abort && ++sinceCheck >= 16) {
      sinceCheck = 0;
      if (opts.abort()) return null;
    }
  }
  return result;
}
