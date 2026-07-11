# NestFlow AI

**Intelligent nesting platform for CNC / laser / plotter cutting.** NestFlow
arranges imported vector parts on stock sheets to minimise material waste — the
kind of software sign shops, CNC/laser workshops, and manufacturers use to save
material and money, comparable to DeepNest / SVGNest and commercial nesting
suites.

Supported materials (by intent): acrylic, PVC, MDF, ACP, foam board, wood,
plastic, sheet metal, vinyl.

---

## Status — read this first

This repository is being built in phases. The **computational core — the
nesting engine — is implemented, tested, and runnable today.** The surrounding
SaaS product (web app, API, auth, billing, storage) is scaffolded as a roadmap,
not yet built. This document is honest about that line so nobody mistakes a plan
for a shipped feature.

| Area | State |
| --- | --- |
| **`@nestflow/engine`** — NFP/Minkowski geometry, GA + simulated annealing, hole filling, multi-sheet, metrics, SVG render | ✅ **Implemented, 39 passing tests, runnable demo + benchmark** |
| **`apps/web`** — full web app: landing page, email/password auth, credit-metered nesting tool, admin dashboard | ✅ **Runnable — `npm run dev`** |
| **`apps/api`** — backend (Fastify + built-in SQLite + JWT): server-side auth, atomic credit charging, admin API; serves the built app in production | ✅ **12 passing tests** |
| **File import — SVG + DXF** (browser): curves/arcs/bulges flattened, holes detected, loops chained | ✅ In the app |
| **Text → letters** — type a word, cut its glyphs (counters/holes detected, tight nesting) | ✅ In the app |
| **Common-line cutting** — detect shared edges (cut once), optimise cut order (NN + 2-opt), savings metric | ✅ Engine + app |
| **Export — SVG + DXF** (machine-ready, mm units) | ✅ In the app |
| **Deploy** — single container/process serves API + app; Dockerfile + [docs/DEPLOY.md](docs/DEPLOY.md) | ✅ Ready |
| File import PLT/EPS/PDF; payments (Stripe); Konva editor; Postgres for multi-node | ⛏️ Planned — see roadmap |
| Backend API (NestJS, Prisma, Redis/BullMQ) | ⛏️ Planned |
| Auth, billing, storage, admin | ⛏️ Planned |

The first build session focused deliberately on the engine — the hardest,
most differentiating part, and the piece everything else depends on.

---

## Repository layout

```
nestflow/
├── package.json            # npm workspaces root
├── tsconfig.base.json      # shared strict TypeScript config
├── packages/
│   └── engine/             # @nestflow/engine — the nesting core (built)
├── apps/                   # (planned) web + api
└── docs/
    ├── ARCHITECTURE.md     # intended full-stack architecture
    ├── ROADMAP.md          # phased plan mapping every spec feature
    └── PRODUCTION_CHECKLIST.md
```

---

## Quick start (engine)

```bash
npm install
npm run dev                          # API (:8787) + web app (:5173) together
npm test                             # engine (47 tests) + API (12 tests)
npm run build && npm start           # production: one process serves app + API
npm run engine:demo                  # nest a sample job -> SVG files
```

Open http://localhost:5173 — sign up (100 free credits), nest letters or your
own SVG/DXF, export a machine-ready file. The admin dashboard lives at `#/admin`.
Nesting runs in a Web Worker in the browser; the API owns auth and credit
accounting (prices recomputed server-side). Deployment: [docs/DEPLOY.md](docs/DEPLOY.md).

The demo nests a realistic 47-part sign-shop job onto an 800×600 mm sheet and
writes an SVG you can open in any browser. On the sample job the engine fits
every part on **one** sheet where a naive bounding-box packer needs **two** — a
full sheet of material saved.

### Using the engine in code

```ts
import { nest, resultToSVG, type Part, type NestConfig } from '@nestflow/engine';

const parts: Part[] = [
  { id: 'washer', contour: { outer: /* ccw ring */ [], holes: [/* inner ring */] }, quantity: 8 },
];
const config: NestConfig = {
  sheet: { width: 1200, height: 800, margin: 5, cost: 45 },
  units: 'mm',
  rotations: [0, 90, 180, 270],
  spacing: 3,
  holeFilling: true,
  strategy: 'balanced',
  machine: { cutSpeed: 25, travelSpeed: 200, hourlyRate: 75 },
};

const result = nest(parts, config);
console.log(result.sheetsUsed, 'sheets,', (result.metrics.utilization * 100).toFixed(1), '% used');
```

See [`packages/engine/README.md`](packages/engine/README.md) for the full engine
documentation: the NFP algorithm, architecture, API, performance notes, and
limitations.

---

## How the nesting works (one paragraph)

Collision between two parts is decided by the **No-Fit Polygon**:
`NFP(A,B) = A ⊕ (−B)`. Placing part B so its reference point lands inside
`NFP(A,B)` means overlap; outside means clear. The free space for a new part is
the sheet's **inner-fit polygon** minus the union of the placed parts' NFPs (plus
the interiors of holes, for hole-filling). NFPs are built from robust integer
Minkowski sums, cached per orientation pair, and the placement order + rotations
are optimised by a **genetic algorithm** and **simulated annealing** under a time
budget. Full detail in the engine README.

---

## Tech stack (target)

Frontend: Next.js · React · TypeScript · Tailwind · shadcn/ui · Framer Motion ·
TanStack Query · Konva.js · Zod. Backend: NestJS · PostgreSQL · Prisma · Redis ·
BullMQ. Storage: S3-compatible (R2/S3). Auth: Auth.js. Payments: Stripe.
Geometry: this engine (+ Clipper, earcut). See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## License

UNLICENSED / proprietary (placeholder) — set before any distribution.
