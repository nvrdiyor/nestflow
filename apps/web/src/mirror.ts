import { mirrorContour, type Part } from '@nestflow/engine';
import { mirrorX, multiply } from './matrix';
import type { VectorSource } from './importCommon';

/**
 * Force-mirror: reflects parts across the vertical axis (x = 0) for reverse /
 * back-side cutting — e.g. letters that are stuck onto the BACK of glass or
 * acrylic and must read correctly when viewed through the material.
 *
 * This is distinct from the engine's `allowMirror` (which merely lets the packer
 * flip individual parts for a tighter fit). Here EVERY part is reflected exactly
 * once, before nesting. The nesting contour and the exact vector source receive
 * the SAME reflection of their mm coordinates, so they stay pixel-aligned; a
 * reflection is isometric, so part sizes — and therefore the credit cost — are
 * unchanged.
 */
export function mirrorParts(parts: Part[]): Part[] {
  return parts.map((p) => ({ ...p, contour: mirrorContour(p.contour, 0) }));
}

/** Reflects the exact-geometry sources to match {@link mirrorParts}. */
export function mirrorSources(sources: Map<string, VectorSource>): Map<string, VectorSource> {
  const out = new Map<string, VectorSource>();
  for (const [id, s] of sources) out.set(id, { markup: s.markup, matrix: multiply(mirrorX, s.matrix) });
  return out;
}
