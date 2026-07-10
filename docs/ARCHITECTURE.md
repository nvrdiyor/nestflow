# NestFlow AI — Architecture

This document describes the **target** full-stack architecture. The nesting
engine (`packages/engine`) is built; everything else here is the design the
remaining phases implement. Where a component is not yet built it is marked
_(planned)_.

## System overview

```
        ┌──────────────┐   HTTPS    ┌────────────────────┐
        │  Next.js web │◀──────────▶│   NestJS API       │
        │  (app router)│   REST/WS  │  (REST + WebSocket)│
        └──────┬───────┘            └─────┬───────┬──────┘
               │ Web Worker                │       │
        ┌──────▼───────┐            ┌──────▼──┐ ┌──▼─────────┐
        │ @nestflow/   │            │ Postgres│ │  Redis +   │
        │ engine (WASM │            │ (Prisma)│ │  BullMQ    │
        │ /worker)     │            └─────────┘ └──┬─────────┘
        └──────────────┘                           │ jobs
                                            ┌───────▼────────┐
                                            │  Nest workers  │
                                            │ (engine + I/O) │
                                            └───────┬────────┘
                                                    │
                                            ┌───────▼────────┐
                                            │ S3 / R2 storage│
                                            └────────────────┘
```

The **engine runs in two places**: in the browser (Web Worker / OffscreenCanvas)
for instant interactive previews, and in backend BullMQ workers for large batch
jobs. Because it is pure TypeScript with no native deps, the same code runs in
both — the single most important architectural payoff of the engine design.

## Packages / apps

| Path | Responsibility | State |
| --- | --- | --- |
| `packages/engine` | Nesting core (geometry, NFP, search, metrics, render) | ✅ built |
| `packages/parsers` _(planned)_ | SVG/DXF/PLT(HPGL)/EPS/PDF → `Part[]`, Bézier/arc flattening | plan |
| `packages/export` _(planned)_ | `NestResult` → SVG/DXF/PLT/PDF/EPS/ZIP | plan |
| `packages/shared` _(planned)_ | Shared DTOs, Zod schemas, units | plan |
| `apps/web` _(planned)_ | Next.js frontend, Konva editor, dashboard | plan |
| `apps/api` _(planned)_ | NestJS REST/WS, auth, billing, jobs | plan |

## Data flow: an optimisation

1. **Upload** — user drags files into `apps/web`; presigned PUT to S3/R2.
2. **Parse** — `packages/parsers` extracts contours, holes, compound paths;
   flattens curves to polylines; computes area/bounds/perimeter.
3. **Configure** — material, sheet size, units, machine, spacing/kerf, strategy.
4. **Nest** — small jobs run in a Web Worker for a live preview; large/batch jobs
   are enqueued to BullMQ and processed by API workers calling the same engine.
5. **Review** — Konva canvas renders `NestResult` (via `placementContour`); user
   tweaks and re-nests; metrics/costs update live.
6. **Export** — `packages/export` emits machine files at original scale.
7. **Persist** — projects, versions, and results saved to Postgres; files to S3.

## Backend (NestJS) — planned module map

Feature-based, clean architecture, repository pattern, DI:

`auth` · `users` · `projects` · `files` · `materials` · `machines` ·
`nesting` (enqueues jobs, streams progress over WS) · `exports` · `reports` ·
`billing` (Stripe) · `admin` · `analytics` · `storage`.

Cross-cutting: JWT guards, `class-validator`/Zod DTO validation, rate limiting,
CSRF/XSS/SQLi protections, virus scanning on upload, audit logging.

## Database (Prisma) — planned core entities

`User`, `Account`/`Session` (Auth.js), `Organization`, `Project`, `File`,
`Material`, `Machine`, `NestJob`, `NestResult`, `Placement`, `Sheet`,
`Export`, `Subscription`, `Plan`, `UsageCounter`, `AuditLog`.

`NestJob` stores the input config + part references; `NestResult` stores the
serialized `Placement[]` + metrics so layouts reopen instantly and version.

## Frontend (Next.js) — planned surfaces

Dashboard (projects, recent files, material stats, waste %, history, storage,
plan) · Upload (drag-drop, format detect, preview, validation) · Editor
(Konva/PixiJS: zoom/pan, multi-select, snap, grid, rulers, rotate/resize,
layers, undo/redo, context menu, shortcuts) · Live preview (re-nest on change) ·
Reports (PDF) · Settings (material/machine) · Admin · Billing.

## Performance strategy

- Engine already: NFP caching per orientation pair, grown-outline precompute,
  broad-phase AABB culling, vertex-only candidate scoring, time-budgeted search.
- Planned: Web Worker / OffscreenCanvas offload; virtualized part lists;
  canvas layer caching; batch jobs sharded across BullMQ workers; optional WASM
  Minkowski kernel; spatial-hash broad phase for very dense sheets.

## Security (target)

Auth.js sessions + JWT for API; per-plan rate limits; strict input validation;
signed upload URLs with content-type/size limits and AV scan; parameterized
queries via Prisma; CSP/XSS hardening; least-privilege storage credentials.
