import type { Contour, Point, Ring } from '@nestflow/engine';
import { ringArea } from '@nestflow/engine';
import { contoursToParts, ringsToContours, type ImportResult } from './importCommon';

/**
 * Imports parts from an SVG string, in the browser.
 *
 * Rather than writing a Bézier/arc flattener, we lean on the browser's own
 * geometry engine: every shape element (path, rect, circle, ellipse, polygon…)
 * is an SVGGeometryElement, so `getTotalLength()` + `getPointAtLength()` sample
 * any outline — curves and arcs included — into a polyline. Compound paths
 * (letters like O, A, B, with holes) are separated by detecting the spatial jump
 * that a `moveto` between sub-paths produces, then classified into outer + holes
 * by area and containment.
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

export function importSvgParts(svgText: string, mmPerUnit = 1): ImportResult {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return { parts: [], warnings: ['The SVG could not be parsed.'] };
  const svg = doc.querySelector('svg');
  if (!svg) return { parts: [], warnings: ['No <svg> root element found.'] };

  // Elements must be attached and laid out for getCTM/getPointAtLength.
  const holder = document.createElement('div');
  holder.style.cssText = 'position:absolute;left:-99999px;top:0;width:0;height:0;overflow:hidden';
  const mounted = document.importNode(svg, true);
  holder.appendChild(mounted);
  document.body.appendChild(holder);

  const contours: Contour[] = [];
  try {
    const nodes = mounted.querySelectorAll('path,rect,circle,ellipse,polygon,polyline');
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
      contours.push(...ringsToContours(rings));
    });
  } finally {
    document.body.removeChild(holder);
  }

  const result = contoursToParts(contours, mmPerUnit);
  if (result.parts.length === 0 && result.warnings.length === 0) {
    result.warnings.push('No usable closed shapes were found. Open paths and text are skipped.');
  }
  return result;
}
