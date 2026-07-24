import type { Point, Ring } from '@nestflow/engine';
import { contoursToParts, dedupeRepeatedParts, dropSheetFrames, ringsToContours, type ImportResult } from './importCommon';
import { sampleBspline } from './bspline';

/**
 * DXF importer (browser, pure text — no DOM needed).
 *
 * DXF geometry in the ENTITIES section is often an unordered soup of LINE / ARC /
 * LWPOLYLINE / CIRCLE entities. The importer:
 *   1. tokenises the (group-code, value) stream,
 *   2. converts each entity to polyline points — flattening arcs, circles,
 *      ellipses and LWPOLYLINE bulges,
 *   3. keeps already-closed loops as rings, and
 *   4. chains the remaining open segments end-to-end into closed loops,
 * then groups the loops into parts (outer + holes) like the SVG importer.
 *
 * Two DXF-vs-SVG conventions are normalised here:
 *   - $INSUNITS (header) scales drawing units to millimetres (cm→×10, in→×25.4…)
 *     so a CorelDRAW/AutoCAD file keeps its true size without a manual scale.
 *   - DXF is Y-up while our mm frame is Y-down (SVG) — the geometry is flipped
 *     vertically inside its own bounding box, otherwise text imports upside-down.
 */

interface Pair {
  code: number;
  value: string;
}

interface EntityGroup {
  type: string;
  pairs: Pair[];
}

const ARC_TOL_MM = 0.05; // max chord deviation when flattening arcs, in real mm

function tokenize(text: string): Pair[] {
  const lines = text.split(/\r\n|\r|\n/);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt((lines[i] ?? '').trim(), 10);
    if (Number.isNaN(code)) continue;
    pairs.push({ code, value: (lines[i + 1] ?? '').trim() });
  }
  return pairs;
}

/** Extracts entity groups from the ENTITIES section (splitting on group code 0). */
function entityGroups(pairs: Pair[]): EntityGroup[] {
  // Find the ENTITIES section.
  let start = -1;
  for (let i = 0; i < pairs.length - 1; i++) {
    if (pairs[i]!.code === 0 && pairs[i]!.value === 'SECTION' && pairs[i + 1]!.code === 2 && pairs[i + 1]!.value === 'ENTITIES') {
      start = i + 2;
      break;
    }
  }
  if (start === -1) return [];

  const groups: EntityGroup[] = [];
  let cur: EntityGroup | null = null;
  for (let i = start; i < pairs.length; i++) {
    const p = pairs[i]!;
    if (p.code === 0) {
      if (p.value === 'ENDSEC') break;
      if (cur) groups.push(cur);
      cur = { type: p.value, pairs: [] };
    } else if (cur) {
      cur.pairs.push(p);
    }
  }
  if (cur) groups.push(cur);
  return groups;
}

function first(pairs: Pair[], code: number): number | undefined {
  for (const p of pairs) if (p.code === code) return Number.parseFloat(p.value);
  return undefined;
}

/** mm per drawing unit from the header's $INSUNITS variable (1 when absent). */
function insunitsScale(pairs: Pair[]): number {
  for (let i = 0; i < pairs.length - 1; i++) {
    if (pairs[i]!.code === 9 && pairs[i]!.value === '$INSUNITS') {
      const v = Number.parseInt(pairs[i + 1]!.value, 10);
      const map: Record<number, number> = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 8: 0.0000254, 9: 0.0254 };
      return map[v] ?? 1;
    }
    // Header ends where ENTITIES begin — stop scanning.
    if (pairs[i]!.code === 2 && pairs[i]!.value === 'ENTITIES') break;
  }
  return 1;
}

function arcPoints(cx: number, cy: number, r: number, startDeg: number, endDeg: number, tol: number): Point[] {
  let sweep = endDeg - startDeg;
  while (sweep <= 0) sweep += 360; // DXF arcs go CCW
  const sweepRad = (sweep * Math.PI) / 180;
  const step = 2 * Math.acos(Math.max(0, 1 - tol / Math.max(r, 1e-6)));
  const n = Math.max(2, Math.ceil(sweepRad / Math.max(step, 1e-3)));
  const a0 = (startDeg * Math.PI) / 180;
  const pts: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + sweepRad * (i / n);
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

/** Flattens an LWPOLYLINE bulge arc between p1 and p2 into intermediate points. */
function bulgePoints(p1: Point, p2: Point, bulge: number, tol: number): Point[] {
  const theta = 4 * Math.atan(bulge); // signed included angle
  if (Math.abs(theta) < 1e-9) return [];
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-9) return [];
  const r = dist / (2 * Math.sin(theta / 2)); // signed radius
  const nx = -dy / dist;
  const ny = dx / dist;
  const d = r * Math.cos(theta / 2);
  const cx = (p1.x + p2.x) / 2 + nx * d;
  const cy = (p1.y + p2.y) / 2 + ny * d;
  const startAng = Math.atan2(p1.y - cy, p1.x - cx);
  const rad = Math.abs(r);
  const step = 2 * Math.acos(Math.max(0, 1 - tol / Math.max(rad, 1e-6)));
  const n = Math.max(2, Math.ceil(Math.abs(theta) / Math.max(step, 1e-3)));
  const pts: Point[] = [];
  for (let i = 1; i < n; i++) {
    const a = startAng + theta * (i / n);
    pts.push({ x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) });
  }
  return pts;
}

interface Vertex {
  x: number;
  y: number;
  bulge: number;
}

function polylineFromVertices(verts: Vertex[], closed: boolean, tol: number): Point[] {
  const pts: Point[] = [];
  const n = verts.length;
  if (n === 0) return pts;
  for (let i = 0; i < n; i++) {
    const v = verts[i]!;
    pts.push({ x: v.x, y: v.y });
    const isLast = i === n - 1;
    if (isLast && !closed) break;
    const next = verts[(i + 1) % n]!;
    if (Math.abs(v.bulge) > 1e-12) {
      pts.push(...bulgePoints({ x: v.x, y: v.y }, { x: next.x, y: next.y }, v.bulge, tol));
    }
  }
  return pts;
}

function lwpolyline(pairs: Pair[], tol: number): { pts: Point[]; closed: boolean } {
  const verts: Vertex[] = [];
  let closed = false;
  let cur: Vertex | null = null;
  for (const p of pairs) {
    if (p.code === 70) closed = (Number.parseInt(p.value, 10) & 1) === 1;
    else if (p.code === 10) {
      if (cur) verts.push(cur);
      cur = { x: Number.parseFloat(p.value), y: 0, bulge: 0 };
    } else if (p.code === 20 && cur) cur.y = Number.parseFloat(p.value);
    else if (p.code === 42 && cur) cur.bulge = Number.parseFloat(p.value);
  }
  if (cur) verts.push(cur);
  return { pts: polylineFromVertices(verts, closed, tol), closed };
}

/** Chains open segments into closed loops by matching endpoints within tolerance. */
function chainLoops(segments: Point[][], tol: number): { rings: Ring[]; openChains: Point[][] } {
  const near = (a: Point, b: Point): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= tol;
  const open = segments.filter((s) => s.length >= 2).map((s) => s.slice());
  const rings: Ring[] = [];
  const openChains: Point[][] = [];

  while (open.length) {
    const chain = open.pop()!;
    let extended = true;
    while (extended) {
      extended = false;
      const start = chain[0]!;
      const end = chain[chain.length - 1]!;
      if (chain.length >= 3 && near(start, end)) break;
      for (let i = 0; i < open.length; i++) {
        const seg = open[i]!;
        const s0 = seg[0]!;
        const s1 = seg[seg.length - 1]!;
        if (near(end, s0)) chain.push(...seg.slice(1));
        else if (near(end, s1)) chain.push(...seg.slice(0, -1).reverse());
        else if (near(start, s1)) chain.unshift(...seg.slice(0, -1));
        else if (near(start, s0)) chain.unshift(...seg.slice(1).reverse());
        else continue;
        open.splice(i, 1);
        extended = true;
        break;
      }
    }
    if (chain.length >= 3 && near(chain[0]!, chain[chain.length - 1]!)) {
      chain.pop(); // drop duplicate closing vertex
      if (chain.length >= 3) rings.push(chain);
    } else {
      openChains.push(chain);
    }
  }
  return { rings, openChains };
}

export function importDxfParts(text: string, mmPerUnit = 1): ImportResult {
  const allPairs = tokenize(text);
  const groups = entityGroups(allPairs);
  if (groups.length === 0) return { parts: [], warnings: ['No DXF ENTITIES section found.'] };
  const unitScale = insunitsScale(allPairs);
  const scale = mmPerUnit * unitScale;
  const arcTol = ARC_TOL_MM / Math.max(scale, 1e-9); // in drawing units

  const closedRings: Ring[] = [];
  const openSegments: Point[][] = [];
  const warnings: string[] = [];
  let inserts = 0;
  let splines = 0;

  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi]!;
    // Our own exports put the sheet boundary on a `frame` layer — never a part.
    const layer = g.pairs.find((pr) => pr.code === 8)?.value ?? '';
    if (layer.toLowerCase() === 'frame') continue;
    switch (g.type) {
      case 'LINE': {
        const x1 = first(g.pairs, 10);
        const y1 = first(g.pairs, 20);
        const x2 = first(g.pairs, 11);
        const y2 = first(g.pairs, 21);
        if ([x1, y1, x2, y2].every((v) => v !== undefined)) {
          openSegments.push([
            { x: x1!, y: y1! },
            { x: x2!, y: y2! },
          ]);
        }
        break;
      }
      case 'LWPOLYLINE': {
        const { pts, closed } = lwpolyline(g.pairs, arcTol);
        if (pts.length >= 2) (closed ? closedRings : openSegments).push(pts as Ring);
        break;
      }
      case 'POLYLINE': {
        // Vertices follow as their own VERTEX groups until SEQEND.
        const closed = ((first(g.pairs, 70) ?? 0) as number) & 1 ? true : false;
        const verts: Vertex[] = [];
        while (gi + 1 < groups.length && groups[gi + 1]!.type === 'VERTEX') {
          gi++;
          const vp = groups[gi]!.pairs;
          verts.push({ x: first(vp, 10) ?? 0, y: first(vp, 20) ?? 0, bulge: first(vp, 42) ?? 0 });
        }
        if (gi + 1 < groups.length && groups[gi + 1]!.type === 'SEQEND') gi++;
        const pts = polylineFromVertices(verts, closed, arcTol);
        if (pts.length >= 2) (closed ? closedRings : openSegments).push(pts as Ring);
        break;
      }
      case 'CIRCLE': {
        const cx = first(g.pairs, 10);
        const cy = first(g.pairs, 20);
        const r = first(g.pairs, 40);
        if (cx !== undefined && cy !== undefined && r !== undefined && r > 0) {
          closedRings.push(arcPoints(cx, cy, r, 0, 360, arcTol).slice(0, -1));
        }
        break;
      }
      case 'ARC': {
        const cx = first(g.pairs, 10);
        const cy = first(g.pairs, 20);
        const r = first(g.pairs, 40);
        const a0 = first(g.pairs, 50);
        const a1 = first(g.pairs, 51);
        if ([cx, cy, r, a0, a1].every((v) => v !== undefined) && r! > 0) {
          openSegments.push(arcPoints(cx!, cy!, r!, a0!, a1!, arcTol));
        }
        break;
      }
      case 'ELLIPSE': {
        const cx = first(g.pairs, 10);
        const cy = first(g.pairs, 20);
        const mx = first(g.pairs, 11) ?? 0;
        const my = first(g.pairs, 21) ?? 0;
        const ratio = first(g.pairs, 40) ?? 1;
        const t0 = first(g.pairs, 41) ?? 0;
        const t1 = first(g.pairs, 42) ?? Math.PI * 2;
        if (cx !== undefined && cy !== undefined) {
          const major = Math.hypot(mx, my);
          const rot = Math.atan2(my, mx);
          const minor = major * ratio;
          let sweep = t1 - t0;
          if (sweep <= 0) sweep += Math.PI * 2;
          const n = Math.max(16, Math.ceil((sweep / (Math.PI * 2)) * 64));
          const pts: Point[] = [];
          for (let i = 0; i <= n; i++) {
            const t = t0 + sweep * (i / n);
            const ex = major * Math.cos(t);
            const ey = minor * Math.sin(t);
            pts.push({ x: cx + ex * Math.cos(rot) - ey * Math.sin(rot), y: cy + ex * Math.sin(rot) + ey * Math.cos(rot) });
          }
          const full = Math.abs(sweep - Math.PI * 2) < 1e-6;
          if (full) closedRings.push(pts.slice(0, -1));
          else openSegments.push(pts);
        }
        break;
      }
      case 'SPLINE': {
        // Evaluate the actual B-spline (de Boor) instead of connecting control
        // points, which are NOT on the curve. Order-following pairing of 10/20
        // (control) and 11/21 (fit) is required — the codes interleave.
        const flags = first(g.pairs, 70) ?? 0;
        const degree = first(g.pairs, 71) ?? 3;
        const knots: number[] = [];
        const ctrl: Point[] = [];
        const fit: Point[] = [];
        let cx: number | undefined;
        let fx: number | undefined;
        for (const p of g.pairs) {
          if (p.code === 40) knots.push(Number.parseFloat(p.value));
          else if (p.code === 10) cx = Number.parseFloat(p.value);
          else if (p.code === 20 && cx !== undefined) {
            ctrl.push({ x: cx, y: Number.parseFloat(p.value) });
            cx = undefined;
          } else if (p.code === 11) fx = Number.parseFloat(p.value);
          else if (p.code === 21 && fx !== undefined) {
            fit.push({ x: fx, y: Number.parseFloat(p.value) });
            fx = undefined;
          }
        }
        let pts: Point[] = [];
        if (ctrl.length >= 2) pts = sampleBspline(ctrl, degree, knots);
        else if (fit.length >= 2) pts = fit;
        if (pts.length >= 2) {
          if ((Number(flags) & 1) === 1) closedRings.push(pts as Ring);
          else openSegments.push(pts);
          splines++;
        }
        break;
      }
      case 'INSERT':
        inserts++;
        break;
      default:
        break;
    }
  }

  // Tolerance for chaining, scaled to the drawing size.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const seg of openSegments) {
    for (const p of seg) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const diag = Number.isFinite(minX) ? Math.hypot(maxX - minX, maxY - minY) : 0;
  const tol = Math.max(1e-4, diag * 2e-4);

  // Chain with escalating tolerance: exports from some CAD tools leave gaps
  // between a glyph's segments far larger than numeric noise, and a dropped
  // chain means a letter loses half its outline. Retries are HARD-CAPPED at
  // 1.5 real millimetres — an uncapped retry once bridged 46mm across a
  // glyph's mouth, fusing it into a bogus ring that swallowed neighbouring
  // bars as "holes" and stuck out of the sheet.
  let chained = chainLoops(openSegments, tol);
  const rings = [...closedRings, ...chained.rings];
  let prevTol = tol;
  for (const retryMm of [0.5, 1.5]) {
    if (!chained.openChains.length) break;
    const t = retryMm / Math.max(scale, 1e-9); // absolute mm, in drawing units
    if (t <= prevTol) continue;
    prevTol = t;
    chained = chainLoops(chained.openChains, t);
    rings.push(...chained.rings);
  }
  const openCount = chained.openChains.length;

  const frameScan = dropSheetFrames(rings);
  if (frameScan.dropped > 0) {
    rings.length = 0;
    rings.push(...frameScan.rings);
    warnings.push('Sheet frame rectangle ignored.');
  }

  // DXF is Y-up, our mm frame is Y-down: flip vertically inside the drawing's
  // own bbox so shapes (and especially text) come in upright, not mirrored.
  let ryMin = Infinity;
  let ryMax = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      if (p.y < ryMin) ryMin = p.y;
      if (p.y > ryMax) ryMax = p.y;
    }
  }
  if (Number.isFinite(ryMin)) {
    const flipAt = ryMin + ryMax;
    for (const ring of rings) for (const p of ring) p.y = flipAt - p.y;
  }

  if (inserts > 0) warnings.push(`${inserts} block insert(s) skipped — explode blocks before export.`);
  if (openCount > 0) warnings.push(`${openCount} open outline(s) could not be closed.`);
  void splines;

  const result = contoursToParts(ringsToContours(rings), scale, undefined, 0, true);
  result.parts = dedupeRepeatedParts(result.parts, result.sources, result.fineContours);
  result.warnings.unshift(...warnings);
  if (result.parts.length === 0 && warnings.length === 0) {
    result.warnings.push('No closed loops found in the DXF.');
  }
  return result;
}
