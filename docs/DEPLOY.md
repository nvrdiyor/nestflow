# Deploying NestFlow AI

One Node process serves everything: the API (`/api/*`) and the built web app.
State is a single SQLite file — no external database to provision.

## Requirements

- Node.js **≥ 22.5** (uses the built-in `node:sqlite`) — or Docker.
- ~256 MB RAM is plenty to start.

## Environment variables (production checklist)

| Variable | Required | Notes |
| --- | --- | --- |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | **Yes — change them** | Admin panel login. Defaults are development-only. |
| `JWT_SECRET` | Recommended | Long random string. Auto-generated into `data/jwt-secret` if unset (fine for a single instance). |
| `PORT` / `HOST` | No | Default `8787` / `0.0.0.0`. |
| `TRUST_PROXY` | **Yes if behind a proxy** | `false` (default) when exposed directly. Behind Caddy/nginx/a PaaS router set the hop count (usually `1`). Wrong values let attackers spoof their IP and bypass login rate limits. |
| `DATA_DIR` | No | Where the SQLite DB lives. **Must be persistent storage.** |
| `CORS_ORIGIN` | No | Set to your domain if you ever host the frontend separately. |
| `STARTING_CREDITS` | No | Free credits per new account (default 100). |

## Fastest: one-command bootstrap (fresh Ubuntu/Debian VPS)

Installs Docker, clones the repo into `/opt/nestflow`, generates a strong admin
password + JWT secret (printed once — save it), opens the firewall and starts
the stack. Idempotent — re-run it any time to pull updates and rebuild.

```bash
# IP-only (site at http://SERVER_IP):
curl -fsSL https://raw.githubusercontent.com/nvrdiyor/nestflow/main/deploy/vps-bootstrap.sh | bash

# Later, once your domain's A record points at this server — switch to HTTPS:
curl -fsSL https://raw.githubusercontent.com/nvrdiyor/nestflow/main/deploy/vps-bootstrap.sh | DOMAIN=your-domain.uz bash
```

## Option A — VPS with docker compose (recommended)

```bash
# One-time: install Docker (Ubuntu/Debian)
curl -fsSL https://get.docker.com | sh

git clone https://github.com/nvrdiyor/nestflow.git && cd nestflow
cp .env.deploy.example .env
nano .env                        # set ADMIN_PASSWORD (required)

# IP-only (site at http://SERVER_IP):
docker compose up -d --build

# Or with a domain + free automatic HTTPS:
#   point your domain's A record to the server IP, then in .env set
#   DOMAIN=your-domain.com, HTTP_PORT=127.0.0.1:8787 and TRUST_PROXY=1
docker compose --profile https up -d --build
```

Updating to the latest code (data survives in the volume):

```bash
cd nestflow && git pull && docker compose up -d --build
```

## Option B — Bare VPS (Ubuntu + Node + PM2)

```bash
git clone https://github.com/nvrdiyor/nestflow.git && cd nestflow
npm ci
npm run build
ADMIN_USERNAME=youradmin ADMIN_PASSWORD='a-strong-password' \
  pm2 start apps/api/dist/index.js --name nestflow
pm2 save && pm2 startup
```

Put nginx/Caddy in front for HTTPS (Caddy: `reverse_proxy localhost:8787` — done).

## Option C — PaaS (Railway / Render / Fly.io)

All three auto-detect the `Dockerfile`:

1. Connect the GitHub repo (`nvrdiyor/nestflow`).
2. Add a **persistent volume** mounted at `/app/apps/api/data`.
3. Set `ADMIN_USERNAME`, `ADMIN_PASSWORD` (and optionally `JWT_SECRET`).
4. Expose port `8787`. Deploy.

## Local development

```bash
npm install
npm run dev          # API on :8787 + web on :5173 (proxied /api) together
npm test             # engine (47) + API (12) test suites
npm run build && npm start   # exactly what production runs
```

## Backups

Everything lives in `DATA_DIR` (default `apps/api/data/`): `nestflow.db` and
`jwt-secret`. Copy that directory — that's the whole backup.

## Scaling notes

SQLite in WAL mode comfortably handles this workload on one node (nesting runs
in the *user's browser*; the server only does auth + accounting). If you later
need multiple instances: move to Postgres (the `Db` class is the only file to
swap), share `JWT_SECRET`, and put the instances behind a load balancer.
