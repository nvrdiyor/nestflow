# @nestflow/engine

Industrial irregular-shape **nesting engine** for CNC / laser / plotter cutting.
Given a set of 2D parts (arbitrary polygons, with holes) and a stock sheet, it
arranges them to minimise material waste — the computational core behind
NestFlow AI, comparable to the engines inside DeepNest / SVGNest and commercial
nesting software.

It is a dependency-light, strictly-typed TypeScript library with no native
addons: geometry robustness comes from the integer [Clipper](https://github.com/junmer/clipper-lib)
library and triangulation from [earcut](https://github.com/mapbox/earcut).

---

## Why this is hard (and how it's solved)

Packing irregular shapes without overlap is NP-hard. The industrial-standard
approach — used here — is the **No-Fit Polygon (NFP)**:

> `NFP(A, B) = A ⊕ (−B)` (the Minkowski sum of A and the reflection of B).
> If B's reference point is placed inside `NFP(A, B)`, B overlaps A; on the
> boundary, they touch; outside, they are clear.

Collision detection between two parts therefore reduces to a **point-in-polygon
test** against a precomputed polygon. Placement becomes: compute the free region
as the sheet's inner-fit polygon minus the union of NFPs of already-placed parts,
then pick the best point in that region.

```
feasible(part) =  IFP(sheet, part)  −  ⋃ NFP(placedᵢ, part)          (+ hole regions)
```

Because the optimal placement under a monotone objective lies at a **vertex** of
the feasible region, only region vertices are evaluated.

### Robust Minkowski sums

A direct Minkowski sum of two non-convex polygons is fragile. Instead each part is
decomposed into convex pieces by ear-clipping triangulation, and

```
A ⊕ B  =  ⋃_{i,j} (triangleᵢ(A) ⊕ triangleⱼ(B))
```

Each convex-convex sum is exact (O(n+m) edge merge); the pieces are unioned with
integer Clipper (non-zero rule), which is numerically robust where floating-point
clippers fail on the many near-degenerate pieces that rotated/curved parts
produce. Part spacing and kerf compensation use Clipper's rounded polygon offset.

---

## Feature summary

| Capability | Notes |
| --- | --- |
| Arbitrary polygons with holes | Compound paths, letters, curves (pre-flattened) |
| No-Fit Polygon collision | Exact, non-convex, with interior no-fit holes |
| Inner-Fit Polygon | Exact rectangular; general erosion for holes |
| **Hole filling** | Small parts nested inside holes of larger parts (e.g. inside an "O") |
| Rotation | Any set of allowed angles per part (0/90/180/270 or arbitrary) |
| Mirroring | Optional per part / globally |
| Part spacing + kerf | Robust polygon offset (rounded joins) |
| Multi-sheet | Automatic overflow to additional sheets, sheet-count limit |
| Search | Bottom-Left / bounding-box greedy, Genetic Algorithm, Simulated Annealing |
| Strategies | `fast` / `balanced` / `max` presets + custom time budget |
| Determinism | Seedable RNG → reproducible layouts |
| Metrics | Utilization, waste, cut length, cut time, machine + material cost, savings |
| Rendering | Standalone SVG of the layout (holes cut out, per-part colours) |

---

## Install & scripts

```bash
npm install                # from the monorepo root
npm run -w @nestflow/engine test      # vitest suite
npm run -w @nestflow/engine demo      # nests a sample job -> examples/output/*.svg
npm run -w @nestflow/engine bench     # scaling benchmark
npm run -w @nestflow/engine build     # tsc -> dist/
```

---

## Usage

```ts
import { nest, resultToSVG, type Part, type NestConfig } from '@nestflow/engine';

const parts: Part[] = [
  // A washer: outer circle with a concentric hole, 8 copies.
  {
    id: 'washer',
    contour: { outer: circle(40), holes: [circle(18)] },
    quantity: 8,
  },
  // An L-bracket, 4 copies, only upright or on its side.
  {
    id: 'bracket',
    contour: { outer: [ /* ...ccw points... */ ], holes: [] },
    quantity: 4,
    allowedRotations: [0, 90],
  },
];

const config: NestConfig = {
  sheet: { width: 1200, height: 800, margin: 5, cost: 45 },
  units: 'mm',
  rotations: [0, 90, 180, 270],  // default rotations for parts that don't specify
  spacing: 3,                    // gap between parts
  kerf: 0.2,                     // cut width
  holeFilling: true,
  strategy: 'balanced',          // 'fast' | 'balanced' | 'max'
  seed: 12345,                   // reproducible
  machine: { cutSpeed: 25, travelSpeed: 200, hourlyRate: 75, pierceTime: 0.4 },
};

const result = nest(parts, config);

console.log(result.sheetsUsed, 'sheets');
console.log((result.metrics.utilization * 100).toFixed(1), '% utilization');
console.log('$', result.metrics.savedMoney, 'saved vs bounding-box baseline');

// Reconstruct geometry / export
import { placementContour } from '@nestflow/engine';
for (const p of result.placements) {
  const part = parts.find((x) => x.id === p.partId)!;
  const worldContour = placementContour(part, p); // outer + holes, in sheet coords
}

// Or render straight to SVG
const svg = resultToSVG(result, parts);
```

All lengths are in one consistent unit (typically millimetres); convert
cm/inch/m before calling. `units` is metadata for reporting only.

---

## Architecture

```
src/
  types.ts            Domain types (Part, Contour, NestConfig, NestResult, metrics)
  rng.ts              Seedable PRNG (mulberry32) for reproducible search
  geometry/
    vector.ts         Vector math + tolerances
    polygon.ts        Area, centroid, perimeter, bounds, orientation, point-in-poly,
                      rotate / mirror / translate, convexity
    convexHull.ts     Andrew monotone-chain hull
    simplify.ts       Ramer–Douglas–Peucker simplification
    clipper.ts        Integer-Clipper interop (scaling, PolyTree walking) — internal
    boolean.ts        union / intersection / difference (robust, Clipper-backed)
    offset.ts         Robust polygon offset (spacing, kerf)
    minkowski.ts      Triangulation, convex + general Minkowski sum
  nfp/
    nfp.ts            No-Fit Polygon
    ifp.ts            Inner-Fit Polygon (rectangular + general erosion)
    cache.ts          NFP / hole-IFP memoisation across the whole search
  model/prepared.ts   Per-part, per-orientation precomputation (grown outlines)
  placement/
    region.ts         Feasible-region computation + vertex candidate scoring
    greedy.ts         Multi-sheet first-fit placement (BLF / bounding-box)
  search/
    fitness.ts        Layout scoring
    evaluator.ts      Chromosome -> layout (shared NFP cache)
    chromosome.ts     Order + rotation genome, crossover / mutation
    geneticAlgorithm.ts
    simulatedAnnealing.ts
    strategy.ts       fast / balanced / max presets
    search.ts         Orchestration
  metrics/metrics.ts  Utilization, cut length/time, costing, baseline comparison
  render/svg.ts       Layout -> SVG
  nester.ts           nest() / Nester — public entry point
```

**Performance levers:**

- **NFP cache** — NFPs depend only on the *orientations* of two parts, not where
  they are placed. They are computed once per orientation pair (with the fixed
  part at its origin) and translated at each use. A single cache is shared across
  every candidate layout the search evaluates — the dominant speed-up.
- **Grown outlines** — spacing/kerf are baked into each part's outline once, so
  the hot path never re-offsets.
- **Vertex-only candidate evaluation** — placement scores O(region vertices),
  not a grid scan.

The search is time-budgeted: it always returns the best layout found, and larger
jobs simply evaluate fewer candidates within the budget (graceful degradation).

---

## Determinism & testing

The engine is fully deterministic for a fixed `seed` and strategy (provided the
time budget isn't the limiting factor). The vitest suite covers geometry
primitives, Minkowski/NFP/IFP correctness, collision-free placement (verified by
independent polygon-intersection checks), hole filling, multi-sheet overflow,
rotation-to-fit, spacing, and end-to-end metrics.

---

## Limitations & roadmap

- **Input flattening** — Bézier/arc segments must be flattened to polylines before
  nesting (the file-import layer handles this in the full product).
- **General (non-rectangular) sheets** — sheets are treated as rectangles; the
  general inner-fit machinery exists (used for holes) and can be extended to
  arbitrary sheet outlines and defect/keep-out zones.
- **Exact-fit parts** — a part exactly as wide/tall as the usable sheet uses a
  1 µm-scale tolerance safeguard.
- **Roadmap** — Web-Worker/OffscreenCanvas offload, common-line cutting, grain
  constraints, remnant/offcut reuse, and a WASM Minkowski kernel for very large
  jobs.

See `examples/demo.ts` for a runnable end-to-end sample and `bench/benchmark.ts`
for scaling behaviour.
