import opentype, { type Font, type PathCommand } from 'opentype.js';
import type { Part, Point } from '@nestflow/engine';
import { contoursToParts, ringsToContours } from './importCommon';

/**
 * Converts a line of text into nestable letter parts, in the browser.
 *
 * Each glyph outline comes from the bundled font via opentype.js as Bézier path
 * commands; those are flattened to polylines, split into sub-paths, and grouped
 * into outer + counter (hole) contours — so the bowl of an "O", "A" or "e" is cut
 * out correctly. Every glyph becomes its own part so the nester can rearrange the
 * letters freely; mirroring is disabled (a flipped letter is the wrong letter).
 */
let fontPromise: Promise<Font> | null = null;

function loadFont(): Promise<Font> {
  if (!fontPromise) {
    const url = `${import.meta.env.BASE_URL}fonts/Roboto-Bold.ttf`;
    fontPromise = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`font ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => opentype.parse(buf));
  }
  return fontPromise;
}

function cubic(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

function quad(p0: Point, p1: Point, p2: Point, t: number): Point {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y };
}

function flattenGlyph(commands: PathCommand[], samples: number): Point[][] {
  const subpaths: Point[][] = [];
  let cur: Point[] = [];
  let prev: Point = { x: 0, y: 0 };
  for (const c of commands) {
    if (c.type === 'M') {
      if (cur.length >= 2) subpaths.push(cur);
      prev = { x: c.x!, y: c.y! };
      cur = [prev];
    } else if (c.type === 'L') {
      prev = { x: c.x!, y: c.y! };
      cur.push(prev);
    } else if (c.type === 'C') {
      const p1 = { x: c.x1!, y: c.y1! };
      const p2 = { x: c.x2!, y: c.y2! };
      const p3 = { x: c.x!, y: c.y! };
      for (let i = 1; i <= samples; i++) cur.push(cubic(prev, p1, p2, p3, i / samples));
      prev = p3;
    } else if (c.type === 'Q') {
      const p1 = { x: c.x1!, y: c.y1! };
      const p2 = { x: c.x!, y: c.y! };
      for (let i = 1; i <= samples; i++) cur.push(quad(prev, p1, p2, i / samples));
      prev = p2;
    } else if (c.type === 'Z') {
      if (cur.length >= 2) subpaths.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 2) subpaths.push(cur);
  return subpaths;
}

export async function textToParts(text: string, heightMm: number): Promise<Part[]> {
  const font = await loadFont();
  const capHeight = font.tables?.os2?.sCapHeight || font.unitsPerEm * 0.7;
  const fontSize = (heightMm * font.unitsPerEm) / capHeight; // so cap height ≈ heightMm
  // Coarse curve sampling + strong simplification keep each glyph light (~20-40
  // vertices). High-vertex concave glyphs otherwise make NFP nesting explode.
  const samples = Math.max(3, Math.min(10, Math.round(heightMm / 12)));
  const toleranceMm = Math.max(0.5, heightMm * 0.02);

  const parts: Part[] = [];
  let index = 0;
  for (const ch of text) {
    if (ch.trim() === '') continue; // skip spaces
    const glyph = font.charToGlyph(ch);
    if (!glyph || typeof glyph.getPath !== 'function') continue;
    const subpaths = flattenGlyph(glyph.getPath(0, 0, fontSize).commands, samples);
    if (!subpaths.length) continue;
    const built = contoursToParts(ringsToContours(subpaths), 1, toleranceMm);
    for (const p of built.parts) {
      parts.push({ ...p, id: `L${index}`, label: ch, allowMirror: false });
      index++;
    }
  }
  return parts;
}
