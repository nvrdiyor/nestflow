import type { Contour, Part, Point, Ring } from '@nestflow/engine';
import { pointInRing, ringArea, ringCentroid } from '@nestflow/engine';
import { contoursToParts, ringsToContours, type ImportResult, type VectorSource } from './importCommon';
import { identity, invert, multiply, scaled, type Mat } from './matrix';

/**
 * Imports parts from an SVG string, in the browser.
 *
 * Two representations are produced per shape:
 *   1. a flattened polygon (sampled via the browser's own path engine) that the
 *      nester uses for collision, and
 *   2. the ORIGINAL geometry element + its transform, so rendering and SVG export
 *      reproduce the exact curves and true dimensions — nothing is re-sampled,
 *      resized, or given an extra outline.
 */
function sampleRings(geo: SVGGeometryElement, ctm: DOMMatrix | null, total: number): Ring[] {
  const step = Math.max(0.6, total / 900);
  const n = Math.min(2400, Math.max(8, Math.ceil(total / step)));
  const pts: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const raw = geo.getPointAtLength((total * i) / n);
    if (ctm) {
      const t = new DOMPoint(raw.x, raw.y).matrixTransform(ctm);
      pts.push({ x: t.x, y: t.y });
    } else {
      pts.push({ x: raw.x, y: raw.y });
    }
  }
  const jump = step * 5;
  const rings: Ring[] = [];
  let cur: Point[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) {
      const a = pts[i]!;
      const b = pts[i - 1]!;
      if (Math.hypot(a.x - b.x, a.y - b.y) > jump) {
        if (cur.length >= 3) rings.push(cur);
        cur = [];
      }
    }
    cur.push(pts[i]!);
  }
  if (cur.length >= 3) rings.push(cur);
  return rings;
}

const DROP_ATTRS = ['transform', 'style', 'class', 'id', 'fill', 'stroke', 'stroke-width', 'fill-rule', 'fill-opacity', 'opacity'];

/** Captures the element's raw geometry (no styling/transform) + its local→mm matrix. */
function captureSource(node: Element, ctm: DOMMatrix | null, mmPerUnit: number): VectorSource {
  const clone = node.cloneNode(false) as Element;
  for (const a of DROP_ATTRS) clone.removeAttribute(a);
  const markup = new XMLSerializer().serializeToString(clone);
  const base: Mat = ctm ? [ctm.a, ctm.b, ctm.c, ctm.d, ctm.e, ctm.f] : identity;
  return { markup, matrix: scaled(base, mmPerUnit) };
}

export function importSvgParts(svgText: string, mmPerUnit = 1): ImportResult {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return { parts: [], warnings: ['The SVG could not be parsed.'] };
  const svg = doc.querySelector('svg');
  if (!svg) return { parts: [], warnings: ['No <svg> root element found.'] };

  const holder = document.createElement('div');
  holder.style.cssText = 'position:absolute;left:-99999px;top:0;width:0;height:0;overflow:hidden';
  const mounted = document.importNode(svg, true);
  holder.appendChild(mounted);
  document.body.appendChild(holder);

  const allParts: ImportResult['parts'] = [];
  const warnings: string[] = [];
  const sources = new Map<string, VectorSource>();
  try {
    const nodes = mounted.querySelectorAll('path,rect,circle,ellipse,polygon,polyline');
    let idx = 0;
    nodes.forEach((node) => {
      const geo = node as unknown as SVGGeometryElement;
      if (typeof geo.getTotalLength !== 'function') return;
      let total = 0;
      try {
        total = geo.getTotalLength();
      } catch {
        return;
      }
      if (!Number.isFinite(total) || total <= 0) return;
      const ctm = typeof geo.getCTM === 'function' ? geo.getCTM() : null;
      const rings = sampleRings(geo, ctm, total).filter((r) => Math.abs(ringArea(r)) > 1e-6);
      const contours: Contour[] = ringsToContours(rings);
      const { parts } = contoursToParts(contours, mmPerUnit, undefined, idx);
      // A single-part element keeps its exact original geometry for output.
      if (parts.length === 1) sources.set(parts[0]!.id, captureSource(node, ctm, mmPerUnit));
      allParts.push(...parts);
      idx += parts.length;
    });
  } finally {
    document.body.removeChild(holder);
  }

  if (allParts.length === 0) warnings.push('No usable closed shapes were found. Open paths and text are skipped.');
  const grouped = groupNestedElements(allParts, sources);
  return { parts: grouped, warnings, sources };
}

/**
 * Cross-element hole grouping. Elements are imported independently, so a washer
 * drawn as TWO <circle> elements arrives as two solid parts — but in cutting
 * semantics a closed contour strictly inside another is a hole (DXF import
 * already groups this way globally). Standard even-odd nesting: odd containment
 * depth = hole of its smallest container, even = standalone part (island).
 * Exact sources are merged too — the hole element's markup is re-expressed in
 * the container's local frame — so curves stay exact end-to-end.
 */
function groupNestedElements(parts: Part[], sources: Map<string, VectorSource>): Part[] {
  if (parts.length < 2) return parts;
  const items = parts
    .map((part) => ({ part, area: ringArea(part.contour.outer), centroid: ringCentroid(part.contour.outer) }))
    .sort((a, b) => b.area - a.area);

  // Containment depth counts EVERY ring (outers and pre-existing holes) of
  // strictly larger parts, on the ORIGINAL structure — so a disc sitting in the
  // hole of a donut counts depth 2 (island), not depth 1 (hole).
  const out: Part[] = [];
  const holeOf = new Map<number, number>(); // item index -> container item index
  for (let i = 0; i < items.length; i++) {
    let depth = 0;
    let innermostOuter = -1;
    for (let j = 0; j < i; j++) {
      if (items[j]!.area <= items[i]!.area) continue;
      if (pointInRing(items[i]!.centroid, items[j]!.part.contour.outer)) {
        depth++;
        innermostOuter = j; // items are sorted by area desc, so the last hit is the smallest
      }
      for (const hole of items[j]!.part.contour.holes) {
        if (pointInRing(items[i]!.centroid, hole)) depth++;
      }
    }
    if (depth % 2 === 1 && innermostOuter >= 0) holeOf.set(i, innermostOuter);
  }
  if (holeOf.size === 0) return parts;

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const container = holeOf.get(i);
    if (container === undefined) {
      out.push(item.part);
      continue;
    }
    const host = items[container]!.part;
    host.contour.holes.push(item.part.contour.outer);
    // The absorbed element's own holes are islands: solid material again.
    for (const islandRing of item.part.contour.holes) {
      out.push({ ...item.part, id: `${item.part.id}-i${out.length}`, contour: { outer: islandRing, holes: [] } });
    }
    // Merge exact sources into ONE <path> with subpaths (holes only render as
    // holes under a single evenodd fill — separate sibling elements would each
    // fill solid). Falls back to the flattened polygon render when not possible.
    const hostSrc = sources.get(host.id);
    const holeSrc = sources.get(item.part.id);
    const merged = hostSrc && holeSrc ? mergeSourceAsSubpath(hostSrc, holeSrc) : null;
    if (merged) sources.set(host.id, merged);
    else sources.delete(host.id);
    sources.delete(item.part.id);
  }
  return out;
}

const num = (el: Element, name: string, dflt = 0): number | null => {
  const raw = el.getAttribute(name);
  if (raw === null) return dflt;
  if (raw.includes('%')) return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
};

/** Exact path data for a basic geometry element (circle/ellipse via two arcs). */
function elementToPathD(markup: string): string | null {
  const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, 'image/svg+xml');
  const el = doc.documentElement.firstElementChild;
  if (!el) return null;
  switch (el.tagName.toLowerCase()) {
    case 'path':
      return el.getAttribute('d');
    case 'rect': {
      const x = num(el, 'x');
      const y = num(el, 'y');
      const w = num(el, 'width');
      const h = num(el, 'height');
      if (x === null || y === null || w === null || h === null) return null;
      if (num(el, 'rx') || num(el, 'ry')) return null; // rounded corners: keep it simple, fall back
      return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
    }
    case 'circle': {
      const cx = num(el, 'cx');
      const cy = num(el, 'cy');
      const r = num(el, 'r');
      if (cx === null || cy === null || r === null || r <= 0) return null;
      return `M${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}Z`;
    }
    case 'ellipse': {
      const cx = num(el, 'cx');
      const cy = num(el, 'cy');
      const rx = num(el, 'rx');
      const ry = num(el, 'ry');
      if (cx === null || cy === null || rx === null || ry === null || rx <= 0 || ry <= 0) return null;
      return `M${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}Z`;
    }
    case 'polygon': {
      const pts = el.getAttribute('points')?.trim();
      return pts ? `M${pts}Z` : null;
    }
    default:
      return null;
  }
}

const isIdentity = (m: Mat): boolean =>
  Math.abs(m[0] - 1) < 1e-9 &&
  Math.abs(m[3] - 1) < 1e-9 &&
  Math.abs(m[1]) < 1e-9 &&
  Math.abs(m[2]) < 1e-9 &&
  Math.abs(m[4]) < 1e-9 &&
  Math.abs(m[5]) < 1e-9;

/**
 * Joins a hole element into its host as an extra subpath of one <path>, keeping
 * both exact. Only when both live in the same local frame (the common case: no
 * transforms) — subpath data cannot carry its own transform.
 */
function mergeSourceAsSubpath(host: VectorSource, hole: VectorSource): VectorSource | null {
  const rel = multiply(invert(host.matrix), hole.matrix);
  if (!isIdentity(rel)) return null;
  const hostD = elementToPathD(host.markup);
  const holeD = elementToPathD(hole.markup);
  if (!hostD || !holeD) return null;
  return { markup: `<path d="${hostD} ${holeD}"/>`, matrix: host.matrix };
}
