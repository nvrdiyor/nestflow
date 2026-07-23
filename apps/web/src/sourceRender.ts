import type { Placement } from '@nestflow/engine';
import type { VectorSource } from './importCommon';
import { colorFor } from './colors';
import { mirrorX, multiply, rotateDeg, toSvg, translate, type Mat } from './matrix';

/** Uniform scale factor of an affine matrix (for keeping stroke width constant). */
function scaleOf(m: Mat): number {
  const det = m[0] * m[3] - m[1] * m[2];
  return Math.sqrt(Math.abs(det)) || 1;
}

/**
 * Builds SVG markup for a placed part from its ORIGINAL geometry: applies only
 * the placement transform (translate ∘ rotate ∘ mirror) on top of the source's
 * local→mm matrix. Curves and dimensions are untouched — the part is merely
 * moved and turned into position.
 */
export function partSvgFor(source: VectorSource, placement: Placement, worldStroke: number): string {
  let m = translate(placement.x, placement.y);
  m = multiply(m, rotateDeg(placement.rotation));
  if (placement.mirrored) m = multiply(m, mirrorX);
  m = multiply(m, source.matrix);
  const color = colorFor(placement.partId);
  void worldStroke; // parts draw flat-filled: no stroke may be added to the shapes
  return `<g transform="${toSvg(m)}" fill="${color}" fill-rule="evenodd">${source.markup}</g>`;
}
