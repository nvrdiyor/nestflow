import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import bcrypt from 'bcryptjs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { Db, type UserRow } from './db.js';
import {
  defaultSettings,
  effectivePlan,
  nestCost,
  PLAN_MONTH_MS,
  PLANS,
  trialEnd,
  STRATEGIES,
  type Plan,
  type PlanSettings,
  type Strategy,
} from './credits.js';
import { TelegramAuth, TG_EMAIL_DOMAIN, type TelegramAuthOptions } from './tgauth.js';
import { ConvertError, detectKind, Gate, MAX_CONVERT_BYTES, systemConverter, type Converter } from './convert.js';
import type { TgUpdate } from './telegram.js';

export interface ServerOptions {
  dbFile: string;
  jwtSecret: string;
  adminUsername: string;
  adminPassword: string;
  webDist?: string;
  corsOrigin?: boolean | string;
  /** Credits a new account starts with (default 0 — the free plan is a few complimentary nests). */
  startingCredits?: number;
  /** Every account is VIP: nests cost 0 credits (usage is still recorded). */
  vipAll?: boolean;
  /**
   * Telegram sign-in bot. When set, "Continue with Telegram" is offered and
   * every email sign-up must be confirmed with a code from the bot.
   */
  telegram?: TelegramAuthOptions;
  logger?: boolean;
  /** PDF / AI / EPS / CDR / DWG → SVG or DXF (default: the command-line tools in the image). */
  converter?: Converter;
  /**
   * Proxy trust for client-IP resolution (rate-limit buckets key on req.ip).
   * MUST stay false when the app is exposed directly — `true`/too-generous
   * values let clients spoof X-Forwarded-For and rotate around rate limits
   * (unlimited login brute-force). Behind a reverse proxy, set the hop count
   * (e.g. 1 for Caddy/nginx in front) or the proxy's IP/CIDR.
   */
  trustProxy?: boolean | number | string;
}

interface TokenPayload {
  sub: string;
  role: 'user' | 'admin';
}

function publicUser(u: UserRow, vipAll: boolean, s: { freeNests: number; trialDays: number }) {
  const plan = effectivePlan(u);
  const trialUntil = plan === 'free' && trialEnd(u, s.trialDays) > Date.now() ? trialEnd(u, s.trialDays) : 0;
  return {
    id: u.id,
    // Telegram-only accounts carry a placeholder address — never show it.
    email: u.email.endsWith(`@${TG_EMAIL_DOMAIN}`) ? '' : u.email,
    name: u.name,
    credits: u.credits,
    /** Unlimited nesting right now (active VIP, the free trial, or the VIP_ALL switch). */
    vip: vipAll || plan === 'vip' || trialUntil > 0,
    plan,
    /** When the active pro/vip plan ends (ms), 0 for free. */
    planUntil: plan === 'free' ? 0 : u.plan_until,
    /** End of the free trial (ms) while it is running, else 0. */
    trialUntil,
    /** Complimentary nests still available (after the trial). */
    freeLeft: Math.max(0, s.freeNests - u.free_used),
    /** Linked Telegram @username ('' when linked without one), null when not linked. */
    telegram: u.telegram_id ? (u.telegram_username ?? '') : null,
    nests: u.nests,
    createdAt: u.created_at,
    lastActive: u.last_active,
  };
}

const registerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(6).max(200),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});

const chargeSchema = z.object({
  parts: z.number().int().min(1).max(100_000),
  strategy: z.enum(STRATEGIES as [Strategy, ...Strategy[]]),
  sheets: z.number().int().min(0).max(10_000),
  utilPct: z.number().min(0).max(100),
});

const adminLoginSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(200),
});

const tgVerifySchema = z.object({
  nonce: z.string().regex(/^[a-f0-9]{32}$/),
  code: z.string().trim().regex(/^\d{6}$/),
});

const adjustSchema = z.object({
  delta: z.number().int().min(-1_000_000).max(1_000_000),
});

const planSchema = z.object({
  plan: z.enum(PLANS as [Plan, ...Plan[]]),
  months: z.number().int().min(1).max(36).default(1),
});

const settingsSchema = z.object({
  proPrice: z.number().int().min(0).max(100_000_000),
  vipPrice: z.number().int().min(0).max(100_000_000),
  proMonthlyCredits: z.number().int().min(0).max(10_000_000),
  freeNests: z.number().int().min(0).max(1000),
  trialDays: z.number().int().min(0).max(365).optional(),
  discount6: z.number().int().min(0).max(90).optional(),
  discount12: z.number().int().min(0).max(90).optional(),
  salesContact: z
    .string()
    .trim()
    .regex(/^@?[A-Za-z0-9_]{3,32}$/)
    .transform((s) => s.replace(/^@/, '')),
});

export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  const db = new Db(opts.dbFile);
  const vipAll = opts.vipAll ?? false;
  const startingCredits = opts.startingCredits ?? 0;
  const settings = (): PlanSettings => {
    const d = defaultSettings();
    const raw = db.settings();
    const int = (v: string | undefined, dflt: number): number => {
      const n = Number(v);
      return v !== undefined && Number.isFinite(n) ? n : dflt;
    };
    return {
      proPrice: int(raw.proPrice, d.proPrice),
      vipPrice: int(raw.vipPrice, d.vipPrice),
      proMonthlyCredits: int(raw.proMonthlyCredits, d.proMonthlyCredits),
      freeNests: int(raw.freeNests, d.freeNests),
      trialDays: int(raw.trialDays, d.trialDays),
      salesContact: raw.salesContact || d.salesContact,
      discount6: int(raw.discount6, d.discount6),
      discount12: int(raw.discount12, d.discount12),
    };
  };
  // VIP, the promo switch, or a free account still inside its trial nest without limits.
  const isUnlimited = (u: UserRow): boolean => {
    const plan = effectivePlan(u);
    return vipAll || plan === 'vip' || (plan === 'free' && trialEnd(u, settings().trialDays) > Date.now());
  };
  const toPublic = (u: UserRow) => publicUser(u, vipAll, settings());
  const tg = opts.telegram ? new TelegramAuth(db, opts.telegram, () => startingCredits) : null;
  const signUser = (u: UserRow): string =>
    app.jwt.sign({ sub: u.id, role: 'user' } satisfies TokenPayload, { expiresIn: '30d' });
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: opts.trustProxy ?? false });

  await app.register(cors, { origin: opts.corsOrigin ?? true });
  await app.register(jwt, { secret: opts.jwtSecret });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
  });

  // Fastify's default 500 body includes err.message (e.g. raw SQLite constraint
  // text) — log the details, return a generic body. 4xx pass through unchanged.
  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      app.log.error(err);
      void reply.status(500).send({ error: 'Internal server error' });
    } else {
      void reply.status(status).send({ error: err.message });
    }
  });

  app.decorate('db', db);
  app.decorate('handleTelegramUpdate', async (u: TgUpdate) => {
    await tg?.onUpdate(u);
  });
  app.addHook('onClose', async () => db.close());

  const requireUser = async (req: FastifyRequest, reply: FastifyReply): Promise<TokenPayload | null> => {
    try {
      const payload = await req.jwtVerify<TokenPayload>();
      if (payload.role !== 'user') throw new Error('wrong role');
      return payload;
    } catch {
      reply.code(401).send({ error: 'Unauthorized' });
      return null;
    }
  };

  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    try {
      const payload = await req.jwtVerify<TokenPayload>();
      if (payload.role !== 'admin') throw new Error('wrong role');
      return true;
    } catch {
      reply.code(401).send({ error: 'Unauthorized' });
      return false;
    }
  };

  const authLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  // ---------- health ----------
  app.get('/api/health', async () => ({ ok: true, uptime: process.uptime() }));

  // Public client configuration: sign-in methods, plan prices, where to buy.
  app.get('/api/config', async () => {
    const s = settings();
    return {
      telegramBot: tg?.botUsername ?? null,
      plans: { pro: { price: s.proPrice, credits: s.proMonthlyCredits }, vip: { price: s.vipPrice } },
      freeNests: s.freeNests,
      trialDays: s.trialDays,
      salesContact: s.salesContact,
      /** Percent off by period length in months (periods not listed: no discount). */
      discounts: { '6': s.discount6, '12': s.discount12 },
    };
  });

  // Real usage totals for the landing page (cached — it is hit by every visitor).
  let statsCache: { at: number; value: { users: number; nests: number; parts: number } } | null = null;
  app.get('/api/stats', async () => {
    if (!statsCache || Date.now() - statsCache.at > 5 * 60_000) statsCache = { at: Date.now(), value: db.publicStats() };
    return statsCache.value;
  });

  // ---------- auth ----------
  app.post('/api/auth/register', authLimit, async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    }
    const { name, email, password } = parsed.data;
    if (db.userByEmail(email)) {
      return reply.code(409).send({ error: 'An account with this email already exists.' });
    }
    const passHash = await bcrypt.hash(password, 10);
    if (tg) {
      // Anti-spam: the account is only created once a Telegram code confirms it.
      return { pending: true, ...tg.open('register', { name, email, passHash }) };
    }
    const user = db.createUser({ email, name, passHash, credits: startingCredits });
    const token = app.jwt.sign({ sub: user.id, role: 'user' } satisfies TokenPayload, { expiresIn: '30d' });
    return { token, user: toPublic(user) };
  });

  app.post('/api/auth/login', authLimit, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid input' });
    const { email, password } = parsed.data;
    const user = db.userByEmail(email);
    if (!user || !(await bcrypt.compare(password, user.pass_hash))) {
      return reply.code(401).send({ error: 'Incorrect email or password.' });
    }
    db.touchUser(user.id);
    const token = app.jwt.sign({ sub: user.id, role: 'user' } satisfies TokenPayload, { expiresIn: '30d' });
    return { token, user: toPublic({ ...user, last_active: Date.now() }) };
  });

  // ---------- Telegram sign-in / sign-up confirmation ----------
  app.post('/api/auth/telegram/start', authLimit, async (_req, reply) => {
    if (!tg) return reply.code(503).send({ error: 'Telegram sign-in is not configured.', code: 'tg_unavailable' });
    return tg.open('login');
  });

  app.post(
    '/api/auth/telegram/verify',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!tg) return reply.code(503).send({ error: 'Telegram sign-in is not configured.', code: 'tg_unavailable' });
      const parsed = tgVerifySchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Wrong code.', code: 'tg_bad_code' });
      const res = await tg.verify(parsed.data.nonce, parsed.data.code);
      if (!res.ok) return reply.code(res.status).send({ error: res.error, code: res.code });
      return { token: signUser(res.user), user: toPublic(res.user), created: res.created };
    },
  );

  app.get('/api/me', async (req, reply) => {
    const payload = await requireUser(req, reply);
    if (!payload) return reply;
    const user = db.userById(payload.sub);
    if (!user) return reply.code(401).send({ error: 'Unauthorized' });
    return { user: toPublic(user) };
  });

  // ---------- file conversion (formats the browser cannot read) ----------
  const converter = opts.converter ?? systemConverter;
  const gate = new Gate(2, 6);
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_CONVERT_BYTES }, (_req, body, done) =>
    done(null, body),
  );
  app.post(
    '/api/convert',
    { bodyLimit: MAX_CONVERT_BYTES, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const payload = await requireUser(req, reply);
      if (!payload) return reply;
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) return reply.code(400).send({ error: 'empty_file' });
      const name = String((req.query as { name?: unknown }).name ?? '').slice(0, 200);
      const kind = detectKind(name, body);
      if (!kind) return reply.code(415).send({ error: 'unsupported_format' });
      try {
        const out = await gate.run(() => converter(body, kind));
        if (out === Gate.BUSY) return reply.code(503).send({ error: 'busy' });
        return { kind, ...out };
      } catch (err) {
        if (err instanceof ConvertError && err.code === 'unavailable') {
          app.log.error(err.message);
          return reply.code(501).send({ error: 'converter_unavailable' });
        }
        return reply.code(422).send({ error: 'convert_failed' });
      }
    },
  );

  // ---------- nesting / credits ----------
  app.post('/api/nest/quote', async (req, reply) => {
    const payload = await requireUser(req, reply);
    if (!payload) return reply;
    const parsed = z
      .object({ parts: z.number().int().min(1).max(100_000), strategy: z.enum(STRATEGIES as [Strategy, ...Strategy[]]) })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid input' });
    const user = db.userById(payload.sub);
    return { cost: user && isUnlimited(user) ? 0 : nestCost(parsed.data.parts) };
  });

  app.post('/api/nest/complete', async (req, reply) => {
    const payload = await requireUser(req, reply);
    if (!payload) return reply;
    const parsed = chargeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid input' });
    const { parts, strategy, sheets, utilPct } = parsed.data;
    const user = db.userById(payload.sub);
    if (!user) return reply.code(401).send({ error: 'Unauthorized' });
    const meta = { parts, strategy, sheets, utilPct };
    const done = (cost: number) => {
      const fresh = db.userById(payload.sub)!;
      return { ok: true, cost, credits: fresh.credits, user: toPublic(fresh) };
    };
    // The server recomputes the price — the client-sent value is never trusted.
    if (isUnlimited(user)) {
      db.chargeNest(payload.sub, { ...meta, cost: 0 });
      return done(0);
    }
    const cost = nestCost(parts);
    if (db.chargeNest(payload.sub, { ...meta, cost }) !== null) return done(cost);
    // No credits for this job: fall back on a complimentary nest if any is left.
    if (db.useFreeNest(payload.sub, settings().freeNests, meta) !== null) return done(0);
    return reply.code(402).send({ error: 'Not enough credits.', code: 'no_credits', cost, credits: user.credits });
  });

  // ---------- admin ----------
  app.post('/api/admin/login', authLimit, async (req, reply) => {
    const parsed = adminLoginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid input' });
    const { username, password } = parsed.data;
    if (!opts.adminPassword || username !== opts.adminUsername || password !== opts.adminPassword) {
      return reply.code(401).send({ error: 'Invalid admin credentials.' });
    }
    const token = app.jwt.sign({ sub: 'admin', role: 'admin' } satisfies TokenPayload, { expiresIn: '12h' });
    return { token };
  });

  app.get('/api/admin/overview', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return reply;
    const users = db.allUsers().map(toPublic);
    const usage = db.recentUsage(50).map((u) => ({
      at: u.at,
      email: u.email.endsWith(`@${TG_EMAIL_DOMAIN}`) ? '' : u.email,
      name: u.name,
      telegram: u.telegram_username,
      parts: u.parts,
      strategy: u.strategy,
      cost: u.cost,
      sheets: u.sheets,
      utilPct: u.util_pct,
    }));
    return { stats: db.stats(), users, usage, settings: settings() };
  });

  // Grant (or revoke) a plan by hand after payment. The same plan extends from
  // its current end; a different plan starts now. PRO adds its monthly credits.
  app.post('/api/admin/users/:id/plan', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return reply;
    const parsed = planSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid input' });
    const { id } = req.params as { id: string };
    const user = db.userById(id);
    if (!user) return reply.code(404).send({ error: 'User not found' });
    const { plan, months } = parsed.data;
    if (plan === 'free') {
      db.setPlan(id, 'free', 0);
    } else {
      const now = Date.now();
      const base = effectivePlan(user, now) === plan ? user.plan_until : now;
      db.setPlan(id, plan, base + months * PLAN_MONTH_MS);
      if (plan === 'pro') db.adjustCredits(id, settings().proMonthlyCredits * months);
    }
    return { user: toPublic(db.userById(id)!) };
  });

  app.get('/api/admin/settings', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return reply;
    return settings();
  });

  app.put('/api/admin/settings', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return reply;
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    // Keys left out (e.g. the discounts from an older panel) keep their current value.
    const entries = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
    db.saveSettings(Object.fromEntries(entries.map(([k, v]) => [k, String(v)])));
    return settings();
  });

  app.post('/api/admin/users/:id/credits', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return reply;
    const parsed = adjustSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid input' });
    const { id } = req.params as { id: string };
    const credits = db.adjustCredits(id, parsed.data.delta);
    if (credits === null) return reply.code(404).send({ error: 'User not found' });
    return { credits };
  });

  // ---------- static frontend (production single-deploy) ----------
  if (opts.webDist && existsSync(join(opts.webDist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: opts.webDist,
      wildcard: true,
      // Disable the plugin's own Cache-Control so setHeaders below wins:
      // index.html must NEVER be cached (it names the hashed bundles) or users
      // keep running stale builds for days; the hashed assets are immutable.
      cacheControl: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('cache-control', 'no-cache');
        } else if (/[\\/]assets[\\/]/.test(filePath)) {
          res.setHeader('cache-control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('cache-control', 'public, max-age=3600');
        }
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api/')) {
        reply.code(404).send({ error: 'Not found' });
      } else {
        // SPA fallback — same no-cache rule as direct index.html hits.
        reply.header('cache-control', 'no-cache').type('text/html').sendFile('index.html');
      }
    });
  }

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    /** Feeds one Telegram bot update (from long polling) into the sign-in flow. */
    handleTelegramUpdate: (u: TgUpdate) => Promise<void>;
  }
}
