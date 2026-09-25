import {
  intersection,
  offsetRegionClipper,
  placementContour,
  regionArea,
  ringBounds,
  type NestResult,
  type Part,
  type Placement,
} from '@nestflow/engine';

/**
 * Hand editing of a finished nest: drag any part to a new spot or turn it by
 * 90° — e.g. to clear a clamp or a flaw in the plate. Every change is checked
 * against the TRUE part outlines: the part must stay inside the sheet's margin
 * and keep the full gap (spacing + kerf) to every other part, otherwise it
 * snaps back. The export and the cut plan follow what was moved.
 */

export type EditVerdict = 'ok' | 'outside' | 'overlap';

export interface EditorHost {
  svgHost: HTMLElement;
  /** Editing is on and a (non-busy) result is on screen. */
  active: () => boolean;
  result: () => NestResult | null;
  parts: () => Part[];
  /** Minimum distance between parts (spacing + kerf). */
  gap: () => number;
  commit: (next: NestResult, selected: number) => void;
  reject: (verdict: Exclude<EditVerdict, 'ok'>) => void;
}

/** Checks a candidate placement of result.placements[index] against the sheet and its neighbours. */
export function checkPlacement(result: NestResult, parts: Part[], index: number, candidate: Placement, gap: number): EditVerdict {
  const map = new Map(parts.map((p) => [p.id, p]));
  const part = map.get(candidate.partId);
  if (!part) return 'outside';
  const c = placementContour(part, candidate);
  const b = ringBounds(c.outer);
  const { width: W, height: H, margin = 0 } = result.config.sheet;
  const eps = 1e-6;
  if (b.minX < margin - eps || b.minY < margin - eps || b.maxX > W - margin + eps || b.maxY > H - margin + eps) {
    return 'outside';
  }
  // Grow the WHOLE contour (outer out, holes in) by the gap: a neighbour may
  // legitimately sit inside one of this part's holes.
  const grown = gap > 0 ? offsetRegionClipper([c], gap - 0.01, 0.005) : [c];
  // Already-cut area of a remnant sheet.
  for (const ring of result.config.remnants?.[candidate.sheet]?.blocked ?? []) {
    const rb = ringBounds(ring);
    if (rb.minX > b.maxX + gap || rb.maxX < b.minX - gap || rb.minY > b.maxY + gap || rb.maxY < b.minY - gap) continue;
    if (regionArea(intersection(grown, [{ outer: ring, holes: [] }])) > 0.05) return 'overlap';
  }
  for (let j = 0; j < result.placements.length; j++) {
    if (j === index) continue;
    const other = result.placements[j]!;
    if (other.sheet !== candidate.sheet) continue;
    const op = map.get(other.partId);
    if (!op) continue;
    const oc = placementContour(op, other);
    const ob = ringBounds(oc.outer);
    if (ob.minX > b.maxX + gap || ob.maxX < b.minX - gap || ob.minY > b.maxY + gap || ob.maxY < b.minY - gap) continue;
    if (regionArea(intersection(grown, [oc])) > 0.05) return 'overlap';
  }
  return 'ok';
}

/** The placement turned by +90° about the centre of its own bounding box. */
export function rotated(parts: Part[], pl: Placement): Placement {
  const part = parts.find((p) => p.id === pl.partId);
  if (!part) return pl;
  const center = (q: Placement): { x: number; y: number } => {
    const b = ringBounds(placementContour(part, q).outer);
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  };
  const next: Placement = { ...pl, rotation: (pl.rotation + 90) % 360 };
  const c0 = center(pl);
  const c1 = center(next);
  return { ...next, x: pl.x + c0.x - c1.x, y: pl.y + c0.y - c1.y };
}

export interface Editor {
  selected(): number | null;
  select(index: number | null): void;
  rotateSelected(): void;
  destroy(): void;
}

export function attachEditor(host: EditorHost): Editor {
  let selected: number | null = null;
  let drag: { index: number; g: SVGGElement; x0: number; y0: number; dx: number; dy: number; pointer: number } | null = null;

  const svgPoint = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const svg = host.svgHost.querySelector('svg');
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  const highlight = (): void => {
    host.svgHost.querySelectorAll('.nf-part.nf-sel').forEach((n) => n.classList.remove('nf-sel'));
    if (selected === null) return;
    host.svgHost.querySelector(`.nf-part[data-pl="${selected}"]`)?.classList.add('nf-sel');
  };

  const tryCommit = (index: number, candidate: Placement): boolean => {
    const r = host.result();
    if (!r) return false;
    const verdict = checkPlacement(r, host.parts(), index, candidate, host.gap());
    if (verdict !== 'ok') {
      host.reject(verdict);
      return false;
    }
    const placements = r.placements.slice();
    placements[index] = candidate;
    selected = index;
    host.commit({ ...r, placements }, index);
    return true;
  };

  const onDown = (e: PointerEvent): void => {
    if (!host.active() || e.button !== 0) return;
    const g = (e.target as Element).closest<SVGGElement>('.nf-part');
    if (!g) return;
    const p = svgPoint(e.clientX, e.clientY);
    if (!p) return;
    e.stopPropagation(); // the viewport would start panning otherwise
    e.preventDefault();
    const index = Number(g.dataset.pl);
    drag = { index, g, x0: p.x, y0: p.y, dx: 0, dy: 0, pointer: e.pointerId };
    selected = index;
    highlight();
    g.classList.add('nf-drag');
  };

  const onMove = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const p = svgPoint(e.clientX, e.clientY);
    if (!p) return;
    drag.dx = p.x - drag.x0;
    drag.dy = p.y - drag.y0;
    drag.g.setAttribute('transform', `translate(${drag.dx.toFixed(3)} ${drag.dy.toFixed(3)})`);
  };

  const onUp = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const d = drag;
    drag = null;
    d.g.classList.remove('nf-drag');
    const r = host.result();
    if (!r || Math.hypot(d.dx, d.dy) < 0.05) {
      d.g.removeAttribute('transform');
      return; // a click: just selects
    }
    const pl = r.placements[d.index];
    if (!pl || !tryCommit(d.index, { ...pl, x: pl.x + d.dx, y: pl.y + d.dy })) d.g.removeAttribute('transform');
  };

  const rotateSelected = (): void => {
    const r = host.result();
    if (!host.active() || selected === null || !r) return;
    const pl = r.placements[selected];
    if (pl) tryCommit(selected, rotated(host.parts(), pl));
  };

  const onKey = (e: KeyboardEvent): void => {
    if (!host.active() || selected === null) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      rotateSelected();
    } else if (e.key === 'Escape') {
      selected = null;
      highlight();
    }
  };

  host.svgHost.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('keydown', onKey);

  return {
    selected: () => selected,
    select(index) {
      selected = index;
      highlight();
    },
    rotateSelected,
    destroy() {
      host.svgHost.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    },
  };
}
