/**
 * Benchmark harness: measures nesting throughput and quality as the job size
 * grows. Run with `npm run bench`.
 *
 * Note: wall-clock timing dominates search depth. Because every strategy honours
 * its time budget, larger jobs simply evaluate fewer candidate layouts in the
 * same time — the search degrades gracefully rather than blowing up.
 */
import { nest, type NestConfig, type Part, type Ring, regularPolygon } from '../src/index.js';

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

/** Builds a mixed job scaled to roughly `n` part instances. */
function buildJob(n: number): Part[] {
  const unit = Math.max(1, Math.round(n / 5));
  return [
    { id: 'tri', contour: { outer: triangle(60, 45), holes: [] }, quantity: unit },
    { id: 'plate', contour: { outer: rect(70, 45), holes: [] }, quantity: unit },
    { id: 'bar', contour: { outer: rect(90, 16), holes: [] }, quantity: unit },
    {
      id: 'ring',
      contour: { outer: regularPolygon(34, 16), holes: [regularPolygon(20, 16)] },
      quantity: unit,
    },
    { id: 'chip', contour: { outer: rect(18, 18), holes: [] }, quantity: unit },
  ];
}

const sizes = [10, 25, 50, 100, 200];
const config: Omit<NestConfig, 'strategy'> = {
  sheet: { width: 1000, height: 700, cost: 40, margin: 4 },
  units: 'mm',
  rotations: [0, 90, 180, 270],
  spacing: 2,
  strategy: 'balanced',
  timeLimitMs: 4000,
};

console.log('NestFlow engine benchmark (strategy=balanced, 4s budget)');
console.log('Note: the budget caps the search loop; a single greedy evaluation of a');
console.log('very large job can still exceed it (the engine always finishes the layout');
console.log('in progress, then stops). Broad-phase culling keeps that floor manageable.\n');
console.log('parts   sheets  utilization  layouts  elapsed(ms)  ms/layout');
for (const size of sizes) {
  const parts = buildJob(size);
  const total = parts.reduce((s, p) => s + (p.quantity ?? 1), 0);
  const result = nest(parts, { ...config, strategy: 'balanced' });
  const perLayout = result.iterations > 0 ? result.elapsedMs / result.iterations : 0;
  console.log(
    [
      String(total).padStart(5),
      String(result.sheetsUsed).padStart(7),
      `${(result.metrics.utilization * 100).toFixed(1)}%`.padStart(12),
      String(result.iterations).padStart(8),
      String(result.elapsedMs).padStart(12),
      perLayout.toFixed(1).padStart(10),
    ].join(' '),
  );
}
