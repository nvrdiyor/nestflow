import { placementContour, resultToSVG, type Contour, type NestResult, type Part, type Ring } from '@nestflow/engine';

/** Triggers a browser download of a text blob. */
function download(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Exports the nested layout as a standalone SVG file (exact geometry if given). */
export function exportSvg(
  result: NestResult,
  parts: Part[],
  partSvg?: (partId: string, placement: NestResult['placements'][number]) => string | null,
  sheetLabel?: (sheetNo: number, utilizationPct: string) => string,
): void {
  download(
    'nestflow-layout.svg',
    resultToSVG(result, parts, { ...(partSvg ? { partSvg } : {}), ...(sheetLabel ? { sheetLabel } : {}) }),
    'image/svg+xml',
  );
}

/**
 * Exports the nested layout as a DXF (LWPOLYLINE per contour). Sheets are laid
 * out left-to-right like the on-screen view; Y is flipped so the drawing is
 * upright in a Y-up CAD/CAM view. Units are millimetres (`$INSUNITS = 4`).
 */
export function exportDxf(result: NestResult, parts: Part[], fineContours?: Map<string, Contour>): void {
  const map = new Map(parts.map((p) => [p.id, p]));
  const sheetW = result.config.sheet.width;
  const sheetH = result.config.sheet.height;
  const gap = Math.max(sheetW, sheetH) * 0.1;

  const out: string[] = [];
  const g = (code: number, value: string | number): void => {
    out.push(String(code), String(value));
  };

  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$INSUNITS');
  g(70, 4); // millimetres
  g(0, 'ENDSEC');
  g(0, 'SECTION');
  g(2, 'ENTITIES');

  const emitRing = (ring: Ring, offsetX: number, layer: string): void => {
    if (ring.length < 3) return;
    g(0, 'LWPOLYLINE');
    g(8, layer);
    g(90, ring.length);
    g(70, 1); // closed
    for (const p of ring) {
      g(10, (p.x + offsetX).toFixed(4));
      g(20, (sheetH - p.y).toFixed(4)); // flip Y for a Y-up CAD view
    }
  };

  for (const placement of result.placements) {
    const part = map.get(placement.partId);
    if (!part) continue;
    // Prefer the finely-sampled import geometry (smooth curves) when available.
    const fine = fineContours?.get(placement.partId);
    const contour = placementContour(fine ? { ...part, contour: fine } : part, placement);
    const offsetX = placement.sheet * (sheetW + gap);
    const layer = `sheet_${placement.sheet + 1}`;
    emitRing(contour.outer, offsetX, layer);
    for (const hole of contour.holes) emitRing(hole, offsetX, layer);
  }

  g(0, 'ENDSEC');
  g(0, 'EOF');
  download('nestflow-layout.dxf', out.join('\n'), 'application/dxf');
}
