import { fitArcs, placementContour, resultToSVG, type Contour, type NestResult, type Part, type Ring } from '@nestflow/engine';

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

/**
 * Exports the nested layout as a MACHINE-READY SVG: only the part geometry
 * (exact curves when available) at true physical mm size — no captions,
 * dimension callouts, background or sheet rectangles that a cutter would
 * misread as cut lines.
 */
export function exportSvg(
  result: NestResult,
  parts: Part[],
  partSvg?: (partId: string, placement: NestResult['placements'][number]) => string | null,
): void {
  download(
    'tasvirai-layout.svg',
    resultToSVG(result, parts, {
      ...(partSvg ? { partSvg } : {}),
      labels: false,
      dimensions: false,
      background: false,
      sheetOutline: false,
      physicalUnits: true,
    }),
    'image/svg+xml',
  );
}

/**
 * Exports the nested layout as a DXF. Sheets are laid out left-to-right like
 * the on-screen view; Y is flipped so the drawing is upright in a Y-up CAD/CAM
 * view. Units are millimetres (`$INSUNITS = 4`).
 *
 * Curves leave as TRUE arcs (LWPOLYLINE bulges fitted to the exact outline
 * within 0.01 mm) instead of thousands of chords — smoother machine motion
 * and much smaller files. Layers carry the job structure, each with its own
 * colour so LightBurn / RDWorks / CAM map them to separate operations:
 *   SHEETn_OUTER (red)  — outer contours of the parts on sheet n
 *   SHEETn_INNER (blue) — holes / counters (cut these first)
 *   FRAME (grey)        — the sheet boundaries; hide or skip when cutting.
 */
export function exportDxf(result: NestResult, parts: Part[], fineContours?: Map<string, Contour>): void {
  download('tasvirai-layout.dxf', buildDxf(result, parts, fineContours), 'application/dxf');
}

export interface DxfOptions {
  /** Fit true arcs to curved runs (default true); false = plain polylines. */
  arcs?: boolean;
  /** Arc-fit tolerance in mm (default 0.01). */
  tolerance?: number;
}

/** DXF colour numbers (ACI). */
const ACI = { outer: 1, inner: 5, frame: 8 };

/** The DXF text of a nested layout (pure — no DOM), see {@link exportDxf}. */
export function buildDxf(
  result: NestResult,
  parts: Part[],
  fineContours?: Map<string, Contour>,
  options: DxfOptions = {},
): string {
  const map = new Map(parts.map((p) => [p.id, p]));
  const sheetW = result.config.sheet.width;
  const sheetH = result.config.sheet.height;
  const gap = Math.max(sheetW, sheetH) * 0.1;
  const sheets = Math.max(result.sheetsUsed, 1);
  const arcs = options.arcs ?? true;
  const tol = options.tolerance ?? 0.01;

  const out: string[] = [];
  const g = (code: number, value: string | number): void => {
    out.push(String(code), String(value));
  };

  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$INSUNITS');
  g(70, 4); // millimetres
  g(0, 'ENDSEC');

  // Layer table: one outer + one inner layer per sheet, plus the frames.
  const layers: Array<[string, number]> = [['FRAME', ACI.frame]];
  for (let s = 1; s <= sheets; s++) layers.push([`SHEET${s}_OUTER`, ACI.outer], [`SHEET${s}_INNER`, ACI.inner]);
  g(0, 'SECTION');
  g(2, 'TABLES');
  g(0, 'TABLE');
  g(2, 'LTYPE');
  g(70, 1);
  g(0, 'LTYPE');
  g(2, 'CONTINUOUS');
  g(70, 0);
  g(3, 'Solid line');
  g(72, 65);
  g(73, 0);
  g(40, 0);
  g(0, 'ENDTAB');
  g(0, 'TABLE');
  g(2, 'LAYER');
  g(70, layers.length);
  for (const [name, color] of layers) {
    g(0, 'LAYER');
    g(2, name);
    g(70, 0);
    g(62, color);
    g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  g(0, 'SECTION');
  g(2, 'ENTITIES');

  const emitRing = (ring: Ring, offsetX: number, layer: string, color: number, fit: boolean): void => {
    if (ring.length < 3) return;
    // Output coordinates first (Y flipped), so arc directions come out right.
    const world = ring.map((p) => ({ x: p.x + offsetX, y: sheetH - p.y }));
    const verts = fit ? fitArcs(world, tol) : world.map((p) => ({ x: p.x, y: p.y, bulge: 0 }));
    if (verts.length < 2) return;
    g(0, 'LWPOLYLINE');
    g(8, layer);
    g(62, color);
    g(90, verts.length);
    g(70, 1); // closed
    for (const v of verts) {
      g(10, v.x.toFixed(4));
      g(20, v.y.toFixed(4));
      if (v.bulge !== 0) g(42, v.bulge.toFixed(8));
    }
  };

  // Sheet boundary frames (their own layer — hide it in CAM if not wanted).
  const frame: Ring = [
    { x: 0, y: 0 },
    { x: sheetW, y: 0 },
    { x: sheetW, y: sheetH },
    { x: 0, y: sheetH },
  ];
  for (let s = 0; s < sheets; s++) emitRing(frame, s * (sheetW + gap), 'FRAME', ACI.frame, false);

  for (const placement of result.placements) {
    const part = map.get(placement.partId);
    if (!part) continue;
    // Prefer the finely-sampled import geometry (smooth curves) when available.
    const fine = fineContours?.get(placement.partId);
    const contour = placementContour(fine ? { ...part, contour: fine } : part, placement);
    const offsetX = placement.sheet * (sheetW + gap);
    const n = placement.sheet + 1;
    emitRing(contour.outer, offsetX, `SHEET${n}_OUTER`, ACI.outer, arcs);
    for (const hole of contour.holes) emitRing(hole, offsetX, `SHEET${n}_INNER`, ACI.inner, arcs);
  }

  g(0, 'ENDSEC');
  g(0, 'EOF');
  return out.join('\n');
}
