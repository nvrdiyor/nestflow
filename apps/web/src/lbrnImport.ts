/**
 * LightBurn project (.lbrn2 / .lbrn) → SVG, so a laser job drawn in LightBurn
 * can be nested directly; the SVG importer then does the rest (true size in
 * mm, holes, exact curves).
 *
 * Supported shapes: Path (lines + cubic Béziers, shared VertID/PrimID lists),
 * Rect (with corner radius), Ellipse, Polygon, Group (nested transforms) and
 * Text through the outline LightBurn caches with it. LightBurn is Y-up, so
 * the drawing is flipped into SVG's Y-down space — letters stay readable.
 * Tool layers (T1/T2) are never cut, so they are skipped.
 */

type Mat = [number, number, number, number, number, number];
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

interface Vert {
  x: number;
  y: number;
  c0?: { x: number; y: number };
  c1?: { x: number; y: number };
}

export interface LbrnResult {
  svg: string;
  /** Text objects without a cached outline (convert them to paths in LightBurn). */
  skippedText: number;
  shapes: number;
}

const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

function parseXForm(shape: Element): Mat {
  const x = childText(shape, 'XForm');
  if (!x) return IDENTITY;
  const v = x.trim().split(/[\s,]+/).map(Number);
  return v.length === 6 && v.every(Number.isFinite) ? (v as Mat) : IDENTITY;
}

function childText(el: Element, tag: string): string | null {
  for (const c of Array.from(el.children)) if (c.tagName === tag) return c.textContent ?? '';
  return null;
}

function num(el: Element, attr: string, dflt = 0): number {
  const v = Number(el.getAttribute(attr));
  return Number.isFinite(v) && el.hasAttribute(attr) ? v : dflt;
}

/** "V10 20c0x12c0y20c1x8c1y20V…" — a control point counts only with both coordinates. */
function parseVertList(s: string): Vert[] {
  const out: Vert[] = [];
  const re = /V\s*([-+\d.eE]+)\s+([-+\d.eE]+)|c([01])([xy])\s*([-+\d.eE]+)/g;
  let cur: (Vert & { raw: Record<string, number> }) | null = null;
  const flush = (): void => {
    if (!cur) return;
    const { raw } = cur;
    if (raw.c0x !== undefined && raw.c0y !== undefined) cur.c0 = { x: raw.c0x, y: raw.c0y };
    if (raw.c1x !== undefined && raw.c1y !== undefined) cur.c1 = { x: raw.c1x, y: raw.c1y };
    out.push({ x: cur.x, y: cur.y, ...(cur.c0 ? { c0: cur.c0 } : {}), ...(cur.c1 ? { c1: cur.c1 } : {}) });
  };
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m[1] !== undefined) {
      flush();
      cur = { x: Number(m[1]), y: Number(m[2]), raw: {} };
    } else if (cur) {
      cur.raw[`c${m[3]}${m[4]}`] = Number(m[5]);
    }
  }
  flush();
  return out;
}

type Prim = { t: 'L' | 'B'; a: number; b: number };

function parsePrimList(s: string, count: number): Prim[] {
  const text = s.trim();
  if (/^LineClosed$/i.test(text)) {
    return Array.from({ length: count }, (_, i) => ({ t: 'L' as const, a: i, b: (i + 1) % count }));
  }
  if (/^LineOpen$/i.test(text)) {
    return Array.from({ length: Math.max(0, count - 1) }, (_, i) => ({ t: 'L' as const, a: i, b: i + 1 }));
  }
  const out: Prim[] = [];
  const re = /([LB])\s*(\d+)\s+(\d+)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push({ t: m[1] as 'L' | 'B', a: Number(m[2]), b: Number(m[3]) });
  return out;
}

export function lbrnToSvg(xml: string): LbrnResult {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  if (!root || root.tagName !== 'LightBurnProject') throw new Error('Not a LightBurn project');

  const paths: string[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let skippedText = 0;
  const vertById = new Map<string, Vert[]>();
  const primById = new Map<string, string>();

  // LightBurn is Y-up: flip into SVG space as the points are emitted.
  const P = (m: Mat, x: number, y: number): string => {
    const wx = m[0] * x + m[2] * y + m[4];
    const wy = -(m[1] * x + m[3] * y + m[5]);
    if (wx < minX) minX = wx;
    if (wx > maxX) maxX = wx;
    if (wy < minY) minY = wy;
    if (wy > maxY) maxY = wy;
    return `${+wx.toFixed(4)} ${+wy.toFixed(4)}`;
  };

  const emitPath = (shape: Element, m: Mat): void => {
    const vid = shape.getAttribute('VertID');
    const pid = shape.getAttribute('PrimID');
    let verts: Vert[] | undefined;
    const vText = childText(shape, 'VertList');
    if (vText !== null && vText.trim()) {
      verts = parseVertList(vText);
      if (vid) vertById.set(vid, verts);
    } else if (vid) verts = vertById.get(vid);
    let pText = childText(shape, 'PrimList');
    if (pText !== null && pText.trim()) {
      if (pid) primById.set(pid, pText);
    } else if (pid) pText = primById.get(pid) ?? null;
    // Old .lbrn: <V vx vy c0x c0y c1x c1y/> and <P T="L|B" p0 p1/> children.
    if (!verts) {
      const vs = Array.from(shape.getElementsByTagName('V'));
      if (vs.length) {
        verts = vs.map((v) => ({
          x: num(v, 'vx'),
          y: num(v, 'vy'),
          ...(v.hasAttribute('c0x') && v.hasAttribute('c0y') ? { c0: { x: num(v, 'c0x'), y: num(v, 'c0y') } } : {}),
          ...(v.hasAttribute('c1x') && v.hasAttribute('c1y') ? { c1: { x: num(v, 'c1x'), y: num(v, 'c1y') } } : {}),
        }));
      }
    }
    if (!verts || verts.length < 2) return;
    let prims: Prim[];
    if (pText) prims = parsePrimList(pText, verts.length);
    else {
      const ps = Array.from(shape.getElementsByTagName('P'));
      prims = ps.length
        ? ps.map((p) => ({ t: (p.getAttribute('T') === 'B' ? 'B' : 'L') as 'L' | 'B', a: num(p, 'p0'), b: num(p, 'p1') }))
        : parsePrimList('LineClosed', verts.length);
    }
    let d = '';
    let first = -1;
    let end = -1;
    for (const pr of prims) {
      const a = verts[pr.a];
      const b = verts[pr.b];
      if (!a || !b) continue;
      if (pr.a !== end) {
        if (first >= 0 && end === first) d += 'Z';
        d += `M${P(m, a.x, a.y)}`;
        first = pr.a;
      }
      if (pr.t === 'B') {
        const c1 = a.c0 ?? a;
        const c2 = b.c1 ?? b;
        d += `C${P(m, c1.x, c1.y)} ${P(m, c2.x, c2.y)} ${P(m, b.x, b.y)}`;
      } else {
        d += `L${P(m, b.x, b.y)}`;
      }
      end = pr.b;
    }
    if (first >= 0 && end === first) d += 'Z';
    if (d) paths.push(d);
  };

  const emitRect = (shape: Element, m: Mat): void => {
    const w = num(shape, 'W');
    const h = num(shape, 'H');
    if (!(w > 0 && h > 0)) return;
    const r = Math.min(num(shape, 'Cr'), w / 2, h / 2);
    const x0 = -w / 2;
    const y0 = -h / 2;
    if (r <= 0) {
      paths.push(`M${P(m, x0, y0)}L${P(m, x0 + w, y0)}L${P(m, x0 + w, y0 + h)}L${P(m, x0, y0 + h)}Z`);
      return;
    }
    // Rounded corners as cubic quarter-circles (k = 0.5523).
    const k = 0.5523 * r;
    const x1 = x0 + w;
    const y1 = y0 + h;
    paths.push(
      `M${P(m, x0 + r, y0)}L${P(m, x1 - r, y0)}C${P(m, x1 - r + k, y0)} ${P(m, x1, y0 + r - k)} ${P(m, x1, y0 + r)}` +
        `L${P(m, x1, y1 - r)}C${P(m, x1, y1 - r + k)} ${P(m, x1 - r + k, y1)} ${P(m, x1 - r, y1)}` +
        `L${P(m, x0 + r, y1)}C${P(m, x0 + r - k, y1)} ${P(m, x0, y1 - r + k)} ${P(m, x0, y1 - r)}` +
        `L${P(m, x0, y0 + r)}C${P(m, x0, y0 + r - k)} ${P(m, x0 + r - k, y0)} ${P(m, x0 + r, y0)}Z`,
    );
  };

  const emitEllipse = (shape: Element, m: Mat): void => {
    const rx = num(shape, 'Rx');
    const ry = num(shape, 'Ry', rx);
    if (!(rx > 0 && ry > 0)) return;
    const kx = 0.5523 * rx;
    const ky = 0.5523 * ry;
    paths.push(
      `M${P(m, rx, 0)}C${P(m, rx, ky)} ${P(m, kx, ry)} ${P(m, 0, ry)}C${P(m, -kx, ry)} ${P(m, -rx, ky)} ${P(m, -rx, 0)}` +
        `C${P(m, -rx, -ky)} ${P(m, -kx, -ry)} ${P(m, 0, -ry)}C${P(m, kx, -ry)} ${P(m, rx, -ky)} ${P(m, rx, 0)}Z`,
    );
  };

  const emitPolygon = (shape: Element, m: Mat): void => {
    const n = Math.round(num(shape, 'N'));
    const rx = num(shape, 'Rx');
    const ry = num(shape, 'Ry', rx);
    if (!(n >= 3 && rx > 0 && ry > 0)) return;
    let d = '';
    for (let i = 0; i < n; i++) {
      const a = Math.PI / 2 + (i * 2 * Math.PI) / n;
      d += `${i ? 'L' : 'M'}${P(m, rx * Math.cos(a), ry * Math.sin(a))}`;
    }
    paths.push(d + 'Z');
  };

  let shapes = 0;
  const walk = (el: Element, parent: Mat): void => {
    for (const shape of Array.from(el.children)) {
      if (shape.tagName === 'Children') {
        walk(shape, parent);
        continue;
      }
      if (shape.tagName !== 'Shape' && shape.tagName !== 'BackupPath') continue;
      if (num(shape, 'CutIndex', 0) >= 30) continue; // T1 / T2 tool layers
      const m = mul(parent, parseXForm(shape));
      const type = shape.getAttribute('Type') ?? '';
      shapes++;
      switch (type) {
        case 'Path':
          emitPath(shape, m);
          break;
        case 'Rect':
          emitRect(shape, m);
          break;
        case 'Ellipse':
          emitEllipse(shape, m);
          break;
        case 'Polygon':
          emitPolygon(shape, m);
          break;
        case 'Group':
          walk(shape, m);
          break;
        case 'Text': {
          const backup = Array.from(shape.children).find((c) => c.tagName === 'BackupPath');
          if (backup) walk(shape, parent);
          else skippedText++;
          break;
        }
        default:
          break;
      }
    }
  };
  walk(root, IDENTITY);

  if (!paths.length || !Number.isFinite(minX)) {
    return { svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', skippedText, shapes };
  }
  const w = Math.max(1e-3, maxX - minX);
  const h = Math.max(1e-3, maxY - minY);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="${minX} ${minY} ${w} ${h}">` +
    paths.map((d) => `<path d="${d}" fill="none" stroke="#000" stroke-width="0.1"/>`).join('') +
    '</svg>';
  return { svg, skippedText, shapes };
}
