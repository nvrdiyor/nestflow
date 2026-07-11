import { ringBounds, type Part, type Ring } from '@nestflow/engine';

/**
 * A lightweight, instant preview of the loaded parts — arranged in simple
 * wrapping rows (not nested) — so the user immediately SEES what was uploaded or
 * generated before spending credits on a real nest.
 */

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

function ringPath(ring: Ring, dx: number, dy: number): string {
  let d = '';
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    d += `${i === 0 ? 'M' : 'L'}${(p.x + dx).toFixed(2)} ${(p.y + dy).toFixed(2)} `;
  }
  return d + 'Z';
}

export function previewSvg(parts: Part[]): string {
  const items: Part[] = [];
  for (const p of parts) for (let i = 0; i < (p.quantity ?? 1); i++) items.push(p);
  if (!items.length) return '<div class="placeholder">No parts.</div>';

  const boxes = items.map((p) => {
    const b = ringBounds(p.contour.outer);
    return { part: p, b, w: b.maxX - b.minX, h: b.maxY - b.minY };
  });
  const maxW = Math.max(...boxes.map((b) => b.w));
  const areaSum = boxes.reduce((s, x) => s + x.w * x.h, 0);
  const gap = Math.max(2, Math.sqrt(areaSum) * 0.02);
  const rowWidth = Math.max(maxW, Math.sqrt(areaSum) * 3.2);

  const svg: string[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  let totalW = 0;
  for (const box of boxes) {
    if (x > 0 && x + box.w > rowWidth) {
      x = 0;
      y += rowH + gap;
      rowH = 0;
    }
    const dx = x - box.b.minX;
    const dy = y - box.b.minY;
    const color = colorFor(box.part.id);
    let d = ringPath(box.part.contour.outer, dx, dy);
    for (const hole of box.part.contour.holes) d += ' ' + ringPath(hole, dx, dy);
    svg.push(
      `<path d="${d}" fill="${color}" fill-opacity="0.82" fill-rule="evenodd" stroke="${color}" stroke-width="${(
        maxW * 0.006
      ).toFixed(2)}"/>`,
    );
    x += box.w + gap;
    rowH = Math.max(rowH, box.h);
    totalW = Math.max(totalW, x - gap);
  }
  const totalH = y + rowH;
  const pad = gap;
  return `<svg viewBox="${(-pad).toFixed(2)} ${(-pad).toFixed(2)} ${(totalW + 2 * pad).toFixed(2)} ${(
    totalH +
    2 * pad
  ).toFixed(2)}" width="100%" style="max-width:100%;height:auto;opacity:.9">${svg.join('')}</svg>`;
}
