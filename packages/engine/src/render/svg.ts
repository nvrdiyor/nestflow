import type { Contour, NestResult, Part, Placement, Point, Ring } from '../types.js';
import type { CutPlan } from '../cutpath/types.js';
import { orientContour } from '../model/prepared.js';
import { translateContour } from '../geometry/polygon.js';

/**
 * Reconstructs the true world-space geometry of a placement from its source part.
 * The inverse of what the engine consumes — use it for rendering and export.
 */
export function placementContour(part: Part, placement: Placement): Contour {
  const oriented = orientContour(part.contour, placement.rotation, placement.mirrored);
  return translateContour(oriented, placement.x, placement.y);
}

export interface RenderOptions {
  /** Gap between adjacent sheet drawings, in engine units. */
  gap?: number;
  /** Outer padding around the whole drawing, in engine units. */
  padding?: number;
  /** Draw the sheet index and utilization caption. Default true. */
  labels?: boolean;
  /** Stroke width in engine units. Default sheet-relative. */
  strokeWidth?: number;
  /** If provided, overlays the optimised cut path and common-line runs. */
  cutPlans?: CutPlan[];
  /**
   * Optional per-placement override that returns SVG markup for the part in
   * world (sheet-local) coordinates — used to draw the ORIGINAL imported vector
   * (curves intact, exact size) instead of the flattened nesting polygon.
   * Return null to fall back to the flattened contour.
   */
  partSvg?: (partId: string, placement: Placement) => string | null;
}

const PALETTE = [
  '#2563eb',
  '#16a34a',
  '#db2777',
  '#f59e0b',
  '#8b5cf6',
  '#0891b2',
  '#dc2626',
  '#65a30d',
  '#c026d3',
  '#0d9488',
];

function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length] as string;
}

function ringPath(ring: Ring, ox: number, oy: number): string {
  if (ring.length === 0) return '';
  const parts: string[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    parts.push(`${i === 0 ? 'M' : 'L'}${(p.x + ox).toFixed(3)} ${(p.y + oy).toFixed(3)}`);
  }
  parts.push('Z');
  return parts.join(' ');
}

function contourPath(contour: Contour, ox: number, oy: number): string {
  let d = ringPath(contour.outer, ox, oy);
  for (const hole of contour.holes) d += ' ' + ringPath(hole, ox, oy);
  return d;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === '"' ? '&quot;' : '&#39;',
  );
}

/**
 * Renders a nest result as a standalone SVG string: one framed rectangle per
 * sheet laid out in a row, with each placed part drawn in its true position,
 * rotation, and orientation (holes cut out via the even-odd rule).
 */
export function resultToSVG(result: NestResult, parts: Part[], options: RenderOptions = {}): string {
  const gap = options.gap ?? Math.max(result.config.sheet.width, result.config.sheet.height) * 0.08;
  const padding = options.padding ?? gap;
  const labels = options.labels ?? true;
  const sheetW = result.config.sheet.width;
  const sheetH = result.config.sheet.height;
  const margin = result.config.sheet.margin ?? 0;
  const sheetsUsed = Math.max(result.sheetsUsed, 1);
  const stroke = options.strokeWidth ?? Math.max(sheetW, sheetH) / 400;
  const labelH = labels ? Math.max(sheetW, sheetH) * 0.06 : 0;

  const partMap = new Map(parts.map((p) => [p.id, p]));

  const totalW = padding * 2 + sheetsUsed * sheetW + (sheetsUsed - 1) * gap;
  const totalH = padding * 2 + sheetH + labelH;

  const svg: string[] = [];
  svg.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW.toFixed(2)} ${totalH.toFixed(
      2,
    )}" width="${totalW.toFixed(0)}" height="${totalH.toFixed(0)}" font-family="sans-serif">`,
  );
  svg.push(`<rect x="0" y="0" width="${totalW}" height="${totalH}" fill="#0b0e14"/>`);

  // Group placements by sheet.
  const bySheet: Placement[][] = Array.from({ length: sheetsUsed }, () => []);
  for (const p of result.placements) {
    if (p.sheet >= 0 && p.sheet < sheetsUsed) (bySheet[p.sheet] as Placement[]).push(p);
  }

  for (let s = 0; s < sheetsUsed; s++) {
    const ox = padding + s * (sheetW + gap);
    const oy = padding + labelH;
    // Sheet plate.
    svg.push(
      `<rect x="${ox.toFixed(2)}" y="${oy.toFixed(2)}" width="${sheetW}" height="${sheetH}" fill="#111827" stroke="#334155" stroke-width="${stroke}"/>`,
    );
    if (margin > 0) {
      svg.push(
        `<rect x="${(ox + margin).toFixed(2)}" y="${(oy + margin).toFixed(2)}" width="${(
          sheetW -
          2 * margin
        ).toFixed(2)}" height="${(sheetH - 2 * margin).toFixed(2)}" fill="none" stroke="#1f2937" stroke-width="${stroke}" stroke-dasharray="${(stroke * 4).toFixed(2)}"/>`,
      );
    }
    for (const placement of bySheet[s] as Placement[]) {
      const part = partMap.get(placement.partId);
      if (!part) continue;
      const override = options.partSvg?.(placement.partId, placement) ?? null;
      if (override !== null) {
        // Caller-supplied original geometry, in world coords; offset to the sheet.
        svg.push(`<g transform="translate(${ox.toFixed(3)} ${oy.toFixed(3)})">${override}</g>`);
        continue;
      }
      const contour = placementContour(part, placement);
      const color = colorFor(placement.partId);
      svg.push(
        `<path d="${contourPath(contour, ox, oy)}" fill="${color}" fill-opacity="0.85" fill-rule="evenodd" stroke="${color}" stroke-width="${stroke}"/>`,
      );
    }

    const plan = options.cutPlans?.find((p) => p.sheet === s);
    if (plan) {
      // Rapid-travel path (dashed), from the sheet origin through lead-in points.
      let d = `M${ox.toFixed(2)} ${oy.toFixed(2)}`;
      for (const i of plan.order) {
        const p = (plan.contours[i] as { start: Point }).start;
        d += ` L${(p.x + ox).toFixed(2)} ${(p.y + oy).toFixed(2)}`;
      }
      svg.push(
        `<path d="${d}" fill="none" stroke="#94a3b8" stroke-opacity="0.7" stroke-width="${(stroke * 0.8).toFixed(
          3,
        )}" stroke-dasharray="${(stroke * 3).toFixed(2)}"/>`,
      );
      // Common-line runs (cut once), highlighted.
      for (const cl of plan.commonLines) {
        svg.push(
          `<line x1="${(cl.a.x + ox).toFixed(2)}" y1="${(cl.a.y + oy).toFixed(2)}" x2="${(
            cl.b.x + ox
          ).toFixed(2)}" y2="${(cl.b.y + oy).toFixed(2)}" stroke="#f97316" stroke-width="${(stroke * 2.5).toFixed(
            2,
          )}" stroke-linecap="round"/>`,
        );
      }
    }

    if (labels) {
      const util = result.sheetsUsed > 0 ? (result.metrics.utilization * 100).toFixed(1) : '0';
      svg.push(
        `<text x="${ox.toFixed(2)}" y="${(oy - labelH * 0.3).toFixed(
          2,
        )}" fill="#e5e7eb" font-size="${(labelH * 0.6).toFixed(2)}">Sheet ${s + 1} — ${escapeXml(
          `${util}% used`,
        )}</text>`,
      );
    }
  }

  svg.push('</svg>');
  return svg.join('\n');
}
