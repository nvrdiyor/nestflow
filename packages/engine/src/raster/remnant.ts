import type { NestResult, Part, Remnant, Ring } from '../types.js';
import { offsetRegionClipper } from '../geometry/clipper.js';
import { simplifyRing } from '../geometry/simplify.js';
import { placementContour } from '../render/svg.js';

/**
 * The leftover of one sheet of a finished layout, as a {@link Remnant} for a
 * later job: every part cut there becomes blocked (its OUTER outline — the
 * piece and its counters fall out), plus whatever was already blocked if the
 * sheet itself was a remnant. Outlines are thinned by `tol` and grown back by
 * the same amount, so the stored shape is light yet never smaller than the cut.
 */
export function remnantFromSheet(result: NestResult, parts: Part[], sheet: number, tol = 0.05): Remnant {
  const map = new Map(parts.map((p) => [p.id, p]));
  const rings: Ring[] = [...(result.config.remnants?.[sheet]?.blocked ?? [])];
  for (const pl of result.placements) {
    if (pl.sheet !== sheet) continue;
    const part = map.get(pl.partId);
    if (!part) continue;
    const outer = placementContour(part, pl).outer;
    rings.push(outer.length > 24 ? simplifyRing(outer, tol) : outer);
  }
  const grown = rings.length ? offsetRegionClipper(rings.map((outer) => ({ outer, holes: [] })), tol, tol / 5) : [];
  return { blocked: grown.map((c) => c.outer) };
}

/** Area still free on a remnant, as a fraction of the usable sheet (0…1). */
export function remnantFreeFraction(rem: Remnant, width: number, height: number, margin = 0): number {
  const usable = Math.max(1e-9, (width - 2 * margin) * (height - 2 * margin));
  let used = 0;
  for (const r of rem.blocked) {
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j]!.x + r[i]!.x) * (r[j]!.y - r[i]!.y);
    used += Math.abs(a) / 2;
  }
  return Math.max(0, Math.min(1, 1 - used / usable));
}
