import { regularPolygon, type Part, type Ring } from '@nestflow/engine';

export type SampleKey = 'signshop' | 'letters' | 'rects' | 'dense';

function rect(w: number, h: number): Ring {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

function triangle(base: number, height: number): Ring {
  return [
    { x: 0, y: 0 },
    { x: base, y: 0 },
    { x: base / 2, y: height },
  ];
}

function lShape(a: number, b: number, t: number): Ring {
  return [
    { x: 0, y: 0 },
    { x: a, y: 0 },
    { x: a, y: t },
    { x: t, y: t },
    { x: t, y: b },
    { x: 0, y: b },
  ];
}

function ring(outerR: number, innerR: number, sides = 16) {
  return { outer: regularPolygon(outerR, sides), holes: [regularPolygon(innerR, sides)] };
}

/** Builds a named demo part set. */
export function buildSampleSet(key: SampleKey): Part[] {
  switch (key) {
    case 'letters':
      return [
        { id: 'O', label: 'O', contour: ring(80, 48), quantity: 4 },
        { id: 'o', label: 'o', contour: ring(48, 27), quantity: 6 },
        { id: 'chip', label: 'insert', contour: { outer: rect(34, 34), holes: [] }, quantity: 14 },
        { id: 'bar', label: 'stroke', contour: { outer: rect(180, 30), holes: [] }, quantity: 5 },
      ];
    case 'rects':
      return [
        { id: 'plate', label: 'Plate', contour: { outer: rect(180, 120), holes: [] }, quantity: 6 },
        { id: 'panel', label: 'Panel', contour: { outer: rect(120, 90), holes: [] }, quantity: 6 },
        { id: 'bar', label: 'Bar', contour: { outer: rect(240, 36), holes: [] }, quantity: 8 },
        { id: 'chip', label: 'Chip', contour: { outer: rect(50, 50), holes: [] }, quantity: 10 },
      ];
    case 'dense':
      return [
        { id: 'wedge', label: 'Triangle', contour: { outer: triangle(120, 90), holes: [] }, quantity: 16 },
        { id: 'ring', label: 'Ring', contour: ring(64, 40), quantity: 8 },
        { id: 'bracket', label: 'L', contour: { outer: lShape(110, 110, 36), holes: [] }, quantity: 8 },
        { id: 'bar', label: 'Bar', contour: { outer: rect(200, 30), holes: [] }, quantity: 10 },
        { id: 'chip', label: 'Chip', contour: { outer: rect(32, 32), holes: [] }, quantity: 24 },
      ];
    case 'signshop':
    default:
      return [
        { id: 'wedge', label: 'Triangle', contour: { outer: triangle(150, 110), holes: [] }, quantity: 12 },
        { id: 'ring-lg', label: 'Large ring', contour: ring(85, 52), quantity: 4 },
        { id: 'ring-sm', label: 'Small ring', contour: ring(52, 30), quantity: 5 },
        { id: 'bracket', label: 'L-bracket', contour: { outer: lShape(130, 130, 42), holes: [] }, quantity: 2 },
        { id: 'bar', label: 'Bar', contour: { outer: rect(240, 36), holes: [] }, quantity: 6 },
        { id: 'chip', label: 'Chip', contour: { outer: rect(36, 36), holes: [] }, quantity: 18 },
      ];
  }
}
