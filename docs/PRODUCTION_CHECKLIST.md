# Production Checklist

Gate for shipping NestFlow AI to paying users. Items are grouped; the engine
column reflects what already holds today.

## Engine (`@nestflow/engine`)

- [x] Deterministic given a seed; time-budgeted search with graceful degradation
- [x] Collision-free placement verified by independent intersection tests
- [x] Robust geometry backend (integer Clipper) — no float sweepline failures
- [x] Unit tests (geometry, NFP/IFP, placement, hole filling, metrics, e2e)
- [ ] Fuzz/property tests over random polygons (no-overlap invariant)
- [ ] Golden-file benchmark of utilization on standard part sets
- [ ] Web Worker wrapper + cancellation
- [ ] Very-large-job path (spatial broad phase / WASM kernel)

## Correctness & quality

- [ ] Adversarial correctness review of algorithms (in progress)
- [ ] Parser round-trip tests (import → export → re-import equality within tol)
- [ ] Export files validated on real machines (laser/CNC/plotter)
- [ ] Kerf/spacing verified against physical cuts

## Backend

- [ ] Auth flows (incl. OAuth) tested; sessions/JWT rotation
- [ ] Input validation on every endpoint; rate limiting
- [ ] File upload: size/type limits, virus scan, signed URLs
- [ ] SQLi/XSS/CSRF protections; security headers/CSP
- [ ] DB migrations reversible; backups + PITR
- [ ] Job queue idempotency, retries, dead-letter handling
- [ ] Structured logging, metrics, tracing, alerting

## Frontend

- [ ] Responsive; light/dark; keyboard accessible (WCAG AA)
- [ ] Canvas performance at 10k+ objects (virtualization, worker)
- [ ] Error/empty/loading states; optimistic UI where safe
- [ ] Analytics + error reporting (privacy-respecting)

## Commercial / ops

- [ ] Stripe billing + webhooks reconciled; plan limits enforced server-side
- [ ] Admin panel; audit logs; GDPR data export/delete
- [ ] Docker images; CI/CD with staged rollouts; IaC
- [ ] SLA/monitoring; on-call runbook; status page
- [ ] Legal: ToS, privacy policy, real license (replace UNLICENSED placeholder)

## Performance targets

- [ ] Interactive preview < 1s for typical (≤100-part) jobs in-browser
- [ ] Batch throughput scales horizontally with worker count
- [ ] p95 API latency and error budgets defined and met
