# NestFlow AI — Roadmap

Phased plan mapping every feature from the product brief to a build phase. The
engine (Phase 0) is done; later phases are sequenced by dependency and value.

## Phase 0 — Nesting engine ✅ (complete)

- [x] Geometry primitives (area, centroid, perimeter, bounds, hull, simplify)
- [x] Robust boolean ops + polygon offset (integer Clipper)
- [x] Minkowski sum, No-Fit Polygon, Inner-Fit Polygon (rect + general erosion)
- [x] Collision-free placement, bottom-left / bounding-box gravity
- [x] Rotation (arbitrary angle sets) + optional mirroring
- [x] Hole filling (parts inside holes of other parts)
- [x] Multi-sheet overflow + sheet-count limits
- [x] Genetic algorithm + simulated annealing + fast/balanced/max strategies
- [x] Spacing + kerf compensation
- [x] Metrics: utilization, waste, cut length/time, machine + material cost, savings
- [x] SVG rendering; deterministic (seeded); tests + demo + benchmark

## Phase 1 — File I/O (`packages/parsers`, `packages/export`)

- [ ] SVG parser (paths, transforms, compound paths, text→outlines)
- [ ] DXF parser (LWPOLYLINE, SPLINE, CIRCLE, ARC, blocks)
- [ ] PLT/HPGL parser
- [ ] EPS / PDF-vector extraction; AI/CDR best-effort
- [ ] Bézier/arc flattening to tolerance; unit detection & scaling
- [ ] Exporters: SVG, DXF, PLT, PDF, EPS, ZIP (original scale, kerf-aware)
- [ ] Corrupt-file validation & clear errors

## Phase 2 — Backend (`apps/api`, NestJS)

- [ ] Auth (email/password, Google, GitHub, verification, password reset)
- [ ] Projects/files/materials/machines CRUD, repository pattern
- [ ] Nest job queue (BullMQ) + WebSocket progress
- [ ] S3/R2 storage with presigned uploads + AV scan
- [ ] Prisma schema + migrations; seed data
- [ ] Rate limiting, validation, security hardening

## Phase 3 — Frontend (`apps/web`, Next.js)

- [ ] Auth screens + profile
- [ ] Dashboard (projects, stats, waste %, history, storage, plan)
- [ ] Drag-drop upload with preview & format detection
- [ ] Konva editor: zoom/pan, select, snap, grid, rulers, rotate/resize,
      layers, undo/redo, context menu, shortcuts
- [ ] Material/machine settings; live re-nest preview (Web Worker)
- [ ] Export UI; PDF reports

## Phase 4 — Optimization intelligence

- [ ] AI layer: predict rotation/order/utilization; learn from past layouts
- [ ] Common-line cutting; grain/direction constraints
- [ ] Remnant/offcut reuse; defect/keep-out zones
- [ ] Spatial-hash broad phase; optional WASM Minkowski kernel

## Phase 5 — Commercial

- [ ] Stripe billing; Free/Starter/Pro/Enterprise plans + usage limits
- [ ] Admin panel (users, subscriptions, storage, analytics, revenue, logs)
- [ ] Batch processing (10→1000+ files) with report bundles
- [ ] Team/organization workspaces

## Cross-cutting (ongoing)

- [ ] Docker + docker-compose; CI/CD; observability
- [ ] E2E tests (Playwright), API tests, load tests
- [ ] Docs site; onboarding; templates
