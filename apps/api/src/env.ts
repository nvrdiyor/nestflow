import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Environment configuration for the NestFlow API.
 *
 * A tiny dependency-free .env loader: KEY=VALUE lines, `#` comments, values
 * already present in process.env win. The JWT secret is auto-generated and
 * persisted on first boot so a bare `npm start` is secure by default; set
 * JWT_SECRET explicitly when running multiple instances.
 */

const here = dirname(fileURLToPath(import.meta.url));
/** apps/api directory (works from both src/ via tsx and dist/ via node). */
export const API_ROOT = resolve(here, '..');

function loadDotEnv(): void {
  const file = join(API_ROOT, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

export const DATA_DIR = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(API_ROOT, 'data');
mkdirSync(DATA_DIR, { recursive: true });

function jwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = join(DATA_DIR, 'jwt-secret');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const secret = randomBytes(32).toString('hex');
  writeFileSync(file, secret, { encoding: 'utf8', mode: 0o600 }); // owner-only on POSIX
  return secret;
}

/** Parses an integer env var, honoring an explicit 0 (unlike `Number(x) || d`). */
function intEnv(raw: string | undefined, dflt: number): number {
  if (raw === undefined || raw === '') return dflt;
  const n = Number(raw);
  return Number.isFinite(n) ? n : dflt;
}

/** CORS origin: unset/true = reflect any, "false" = disable cross-origin. */
function parseCorsOrigin(raw: string | undefined): boolean | string {
  if (!raw || raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}

/**
 * TRUST_PROXY: "false" (default — app exposed directly), "1"/"2"… (hop count
 * when behind that many reverse proxies), or a proxy IP/CIDR. Never "true" in
 * production unless every hop is trusted; spoofed X-Forwarded-For otherwise
 * defeats rate limiting.
 */
function parseTrustProxy(raw: string | undefined): boolean | number | string {
  if (!raw || raw === 'false') return false;
  if (raw === 'true') return true;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : raw;
}

export const env = {
  port: Number(process.env.PORT) || 8787,
  host: process.env.HOST || '0.0.0.0',
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  jwtSecret: jwtSecret(),
  dbFile: process.env.DB_FILE || join(DATA_DIR, 'nestflow.db'),
  /** Admin credentials — override in production via env / .env. */
  adminUsername: process.env.ADMIN_USERNAME || 'nvrdiyor',
  adminPassword: process.env.ADMIN_PASSWORD || 'd__Iyorbek7777',
  /** True when the admin password came from the committed default, not env. */
  adminPasswordIsDefault: !process.env.ADMIN_PASSWORD,
  /** Directory of the built frontend to serve (empty = API only). */
  webDist: process.env.WEB_DIST ?? resolve(API_ROOT, '..', 'web', 'dist'),
  corsOrigin: parseCorsOrigin(process.env.CORS_ORIGIN),
  startingCredits: intEnv(process.env.STARTING_CREDITS, 100),
} as const;
