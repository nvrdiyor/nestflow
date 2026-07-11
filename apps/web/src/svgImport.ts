import type { Contour, Point, Ring } from '@nestflow/engine';
import { ringArea } from '@nestflow/engine';
import { contoursToParts, ringsToContours, type ImportResult, type VectorSource } from './importCommon';
import { identity, scaled, type Mat } from './matrix';

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
  return { parts: allParts, warnings, sources };
}
