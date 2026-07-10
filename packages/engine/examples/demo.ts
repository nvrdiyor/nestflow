/**
 * Runnable demo: nests a realistic sign-shop job and writes an SVG of each
 * layout so the result can be verified visually. Run with `npm run demo`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  nest,
  resultToSVG,
  regularPolygon,
  type NestConfig,
  type Part,
  type Ring,
  type Strategy,
} from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'output');
mkdirSync(outDir, { recursive: true });

/** An annulus (ring / letter-O style) as an outer polygon with a circular hole. */
function ring(outerR: number, innerR: number, sides = 16): { outer: Ring; holes: Ring[] } {
  return { outer: regularPolygon(outerR, sides), holes: [regularPolygon(innerR, sides)] };
}

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

/** A concave L-shape. */
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

// A job that rewards true irregular nesting: interlocking triangles (whose
// bounding boxes waste ~50% under shelf packing) and rings whose holes swallow
// small chips.
const parts: Part[] = [
  { id: 'wedge', label: 'Triangle', contour: { outer: triangle(150, 110), holes: [] }, quantity: 12 },
  { id: 'ring-lg', label: 'Large ring', contour: ring(85, 52), quantity: 4 },
  { id: 'ring-sm', label: 'Small ring', contour: ring(52, 30), quantity: 5 },
  { id: 'bracket', label: 'L-bracket', contour: { outer: lShape(130, 130, 42), holes: [] }, quantity: 2 },
  { id: 'bar', label: 'Bar', contour: { outer: rect(240, 36), holes: [] }, quantity: 6 },
  { id: 'chip', label: 'Chip', contour: { outer: rect(36, 36), holes: [] }, quantity: 18 },
];

const baseConfig: NestConfig = {
  sheet: { width: 800, height: 600, cost: 45, margin: 5 },
  units: 'mm',
  rotations: [0, 90, 180, 270],
  spacing: 3,
  kerf: 0.2,
  holeFilling: true,
  machine: { cutSpeed: 25, travelSpeed: 200, hourlyRate: 75, pierceTime: 0.4 },
};

/** Per-strategy time budgets keep the demo snappy. */
const timeBudget: Record<Strategy, number> = { fast: 1500, balanced: 5000, max: 10000 };

const totalInstances = parts.reduce((n, p) => n + (p.quantity ?? 1), 0);
console.log(`NestFlow engine demo — ${parts.length} distinct parts, ${totalInstances} instances`);
console.log(`Sheet: ${baseConfig.sheet.width}×${baseConfig.sheet.height} mm\n`);

const strategies: Strategy[] = ['fast', 'balanced', 'max'];
const rows: string[] = [];
rows.push('strategy   engineSheets  baseline  utilization  saved($)  cutLen(mm)  time(ms)  layouts');

for (const strategy of strategies) {
  const result = nest(parts, { ...baseConfig, strategy, timeLimitMs: timeBudget[strategy] });
  const m = result.metrics;
  rows.push(
    [
      strategy.padEnd(10),
      String(result.sheetsUsed).padStart(12),
      String(m.baselineSheets).padStart(9),
      `${(m.utilization * 100).toFixed(1)}%`.padStart(12),
      m.savedMoney.toFixed(0).padStart(9),
      m.totalCutLength.toFixed(0).padStart(11),
      String(result.elapsedMs).padStart(9),
      String(result.iterations).padStart(8),
    ].join(' '),
  );

  const svg = resultToSVG(result, parts);
  const file = join(outDir, `nest-${strategy}.svg`);
  writeFileSync(file, svg, 'utf8');
  if (result.unplaced.length > 0) {
    console.log(`  (${strategy}: ${result.unplaced.length} parts unplaced)`);
  }
}

console.log(rows.join('\n'));
console.log(
  '\nutilization = placed part area / (sheets × sheet area); it is naturally',
);
console.log('lower when the final sheet is only partly filled.');
console.log(`SVG layouts written to ${outDir}`);
