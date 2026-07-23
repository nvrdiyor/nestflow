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
import { nestCost, STRATEGIES, type Strategy } from './credits.js';

export interface ServerOptions {
  dbFile: string;
  jwtSecret: string;
  adminUsername: string;
  adminPassword: string;
  webDist?: string;
  corsOrigin?: boolean | string;
  startingCredits?: number;
  logger?: boolean;
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

function publicUser(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    credits: u.credits,
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

const adjustSchema = z.object({
  delta: z.number().int().min(-1_000_000).max(1_000_000),
});

export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  const db = new Db(opts.dbFile);
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
    const user = db.createUser({ email, name, passHash, credits: opts.startingCredits ?? 100 });
    const token = app.jwt.sign({ sub: user.id, role: 'user' } satisfies TokenPayload, { expiresIn: '30d' });
    return { token, user: publicUser(user) };
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
    return { token, user: publicUser({ ...user, last_active: Date.now() }) };
  });

  app.get('/api/me', async (req, reply) => {
    const payload = await requireUser(req, reply);
    if (!payload) return reply;
    const user = db.userById(payload.sub);
    if (!user) return reply.code(401).send({ error: 'Unauthorized' });
    return { user: publicUser(user) };
  });

  // ---------- nesting / credits ----------
  app.post('/api/nest/quote', async (req, reply) => {
    const payload = await requireUser(req, reply);
    if (!payload) return reply;
    const parsed = z
      .object({ parts: z.number().int().min(1).max(100_000), strategy: z.enum(STRATEGIES as [Strategy, ...Strategy[]]) })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid input' });
    return { cost: nestCost(parsed.data.parts, parsed.data.strategy) };
  });

  app.post('/api/nest/complete', async (req, reply) => {
    const payload = await requireUser(req, reply);
    if (!payload) return reply;
    const parsed = chargeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid input' });
    const { parts, strategy, sheets, utilPct } = parsed.data;
    // The server recomputes the price — the client-sent value is never trusted.
    const cost = nestCost(parts, strategy);
    const remaining = db.chargeNest(payload.sub, { parts, strategy, cost, sheets, utilPct });
    if (remaining === null) {
      const user = db.userById(payload.sub);
      return reply.code(402).send({ error: 'Not enough credits.', cost, credits: user?.credits ?? 0 });
    }
    return { ok: true, cost, credits: remaining };
  });

  // ---------- admin ----------
  app.post('/api/admin/login', authLimit, async (req, reply) => {
    const parsed = adminLoginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid input' });
    const { username, password } = parsed.data;
    if (username !== opts.adminUsername || password !== opts.adminPassword) {
      return reply.code(401).send({ error: 'Invalid admin credentials.' });
    }
    const token = app.jwt.sign({ sub: 'admin', role: 'admin' } satisfies TokenPayload, { expiresIn: '12h' });
    return { token };
  });

  app.get('/api/admin/overview', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return reply;
    const users = db.allUsers().map(publicUser);
    const usage = db.recentUsage(50).map((u) => ({
      at: u.at,
      email: u.email,
      parts: u.parts,
      strategy: u.strategy,
      cost: u.cost,
      sheets: u.sheets,
      utilPct: u.util_pct,
    }));
    return { stats: db.stats(), users, usage };
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
  }
}
