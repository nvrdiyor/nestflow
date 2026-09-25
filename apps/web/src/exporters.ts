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
 * and much smaller files. Layers, each with its own colour so LightBurn /
 * RDWorks / CAM map them to separate operations:
 *   'split'  — SHEETn_OUTER (red) outer contours, SHEETn_INNER (blue) holes
 *   'source' — the layer names of the original drawing
 *   'single' — everything on one CUT layer
 * plus FRAME (grey): the sheet boundaries — hide or skip it when cutting.
 * With `blocks`, every distinct part is written once as a named block and
 * placed with INSERTs (position, rotation, mirror), so CAM sees parts.
 */
export function exportDxf(result: NestResult, parts: Part[], fineContours?: Map<string, Contour>, options: DxfOptions = {}): void {
  download('tasvirai-layout.dxf', buildDxf(result, parts, fineContours, options), 'application/dxf');
}

export interface DxfOptions {
  /** Fit true arcs to curved runs (default true); false = plain polylines. */
  arcs?: boolean;
  /** Arc-fit tolerance in mm (default 0.01). */
  tolerance?: number;
  /** Layer scheme (default 'split'). */
  layers?: 'split' | 'source' | 'single';
  /** Source layer of each part, for layers: 'source'. */
  partLayers?: Map<string, string>;
  /** One block per distinct part + INSERTs. */
  blocks?: boolean;
}

/** DXF colour numbers (ACI). */
const ACI = { outer: 1, inner: 5, frame: 8 };
/** Colours handed out to source layers in order of appearance. */
const SOURCE_COLORS = [1, 5, 3, 6, 4, 2, 30, 140, 200, 40];

/** Characters DXF layer / block names may not contain. */
const dxfName = (s: string): string => s.replace(/[<>/\\":;?*|=`,]/g, '_').trim() || '0';

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
  const scheme = options.layers ?? 'split';
  const blocks = options.blocks === true;

  // Layer of an outer / inner contour of a part on sheet n (1-based).
  const sourceOf = (partId: string): string => dxfName(options.partLayers?.get(partId) ?? 'CUT');
  const layerFor = (partId: string, inner: boolean, n: number): string => {
    if (scheme === 'single') return 'CUT';
    if (scheme === 'source') return sourceOf(partId);
    if (blocks) return inner ? 'INNER' : 'OUTER';
    return `SHEET${n}_${inner ? 'INNER' : 'OUTER'}`;
  };

  // Every layer that will be used, with its colour.
  const layers = new Map<string, number>([['FRAME', ACI.frame]]);
  let nextColor = 0;
  const useLayer = (name: string, inner: boolean): void => {
    if (layers.has(name)) return;
    if (scheme === 'source') layers.set(name, SOURCE_COLORS[nextColor++ % SOURCE_COLORS.length]!);
    else layers.set(name, inner ? ACI.inner : ACI.outer);
  };
  for (const pl of result.placements) {
    useLayer(layerFor(pl.partId, false, pl.sheet + 1), false);
    const part = map.get(pl.partId);
    if (part && part.contour.holes.length) useLayer(layerFor(pl.partId, true, pl.sheet + 1), true);
    if (blocks) useLayer(`SHEET${pl.sheet + 1}`, false);
  }

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
  g(70, layers.size);
  for (const [name, color] of layers) {
    g(0, 'LAYER');
    g(2, name);
    g(70, 0);
    g(62, color);
    g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  /** A closed outline in OUTPUT coordinates (Y-up), arcs fitted there. */
  const emitRing = (world: Ring, layer: string, color: number, fit: boolean): void => {
    if (world.length < 3) return;
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
  const colorOf = (layer: string): number => layers.get(layer) ?? ACI.outer;
  const partContour = (id: string): Contour | null => fineContours?.get(id) ?? map.get(id)?.contour ?? null;

  // Blocks: each distinct part once, in its own frame flipped to Y-up.
  const blockName = new Map<string, string>();
  if (blocks) {
    g(0, 'SECTION');
    g(2, 'BLOCKS');
    for (const pl of result.placements) {
      if (blockName.has(pl.partId)) continue;
      const c = partContour(pl.partId);
      if (!c) continue;
      const name = dxfName(`PART_${blockName.size + 1}`);
      blockName.set(pl.partId, name);
      g(0, 'BLOCK');
      g(8, '0');
      g(2, name);
      g(70, 0);
      g(10, 0);
      g(20, 0);
      g(30, 0);
      g(3, name);
      const up = (r: Ring): Ring => r.map((p) => ({ x: p.x, y: -p.y }));
      const outerLayer = layerFor(pl.partId, false, 1);
      emitRing(up(c.outer), outerLayer, colorOf(outerLayer), arcs);
      const innerLayer = layerFor(pl.partId, true, 1);
      for (const h of c.holes) emitRing(up(h), innerLayer, colorOf(innerLayer), arcs);
      g(0, 'ENDBLK');
      g(8, '0');
    }
    g(0, 'ENDSEC');
  }

  g(0, 'SECTION');
  g(2, 'ENTITIES');

  // Sheet boundary frames (their own layer — hide it in CAM if not wanted).
  for (let s = 0; s < sheets; s++) {
    const ox = s * (sheetW + gap);
    const frame: Ring = [
      { x: ox, y: sheetH },
      { x: ox + sheetW, y: sheetH },
      { x: ox + sheetW, y: 0 },
      { x: ox, y: 0 },
    ];
    emitRing(frame, 'FRAME', ACI.frame, false);
  }

  for (const placement of result.placements) {
    const part = map.get(placement.partId);
    if (!part) continue;
    const offsetX = placement.sheet * (sheetW + gap);
    const n = placement.sheet + 1;
    const block = blockName.get(placement.partId);
    if (block) {
      // Part frame → sheet: mirror, rotate by −θ (Y flipped), then move.
      g(0, 'INSERT');
      g(8, `SHEET${n}`);
      g(2, block);
      g(10, (placement.x + offsetX).toFixed(4));
      g(20, (sheetH - placement.y).toFixed(4));
      g(30, 0);
      g(41, placement.mirrored ? -1 : 1);
      g(42, 1);
      g(43, 1);
      g(50, (((-placement.rotation % 360) + 360) % 360).toFixed(6));
      continue;
    }
    // Prefer the finely-sampled import geometry (smooth curves) when available.
    const fine = fineContours?.get(placement.partId);
    const contour = placementContour(fine ? { ...part, contour: fine } : part, placement);
    const toOut = (r: Ring): Ring => r.map((p) => ({ x: p.x + offsetX, y: sheetH - p.y }));
    const outerLayer = layerFor(placement.partId, false, n);
    emitRing(toOut(contour.outer), outerLayer, colorOf(outerLayer), arcs);
    const innerLayer = layerFor(placement.partId, true, n);
    for (const hole of contour.holes) emitRing(toOut(hole), innerLayer, colorOf(innerLayer), arcs);
  }

  g(0, 'ENDSEC');
  g(0, 'EOF');
  return out.join('\n');
}
