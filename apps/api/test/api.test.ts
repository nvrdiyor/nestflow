import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { nestCost } from '../src/credits.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer({
    dbFile: ':memory:',
    jwtSecret: 'test-secret',
    adminUsername: 'admin',
    adminPassword: 'admin-pass',
    startingCredits: 100,
    webDist: '', // API only in tests
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function registerUser(email = 'a@b.co'): Promise<{ token: string; user: { id: string; credits: number } }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { name: 'Test User', email, password: 'secret123' },
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe('credit pricing', () => {
  it('matches the documented formula', () => {
    expect(nestCost(10, 'fast')).toBe(2);
    expect(nestCost(47, 'balanced')).toBe(7);
    expect(nestCost(100, 'max')).toBe(13);
    expect(nestCost(1, 'fast')).toBe(2);
  });
});

describe('auth', () => {
  it('registers with starting credits and returns a token', async () => {
    const { token, user } = await registerUser('reg@test.co');
    expect(token).toBeTruthy();
    expect(user.credits).toBe(100);
  });

  it('rejects duplicate email with 409', async () => {
    await registerUser('dup@test.co');
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'X', email: 'dup@test.co', password: 'secret123' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects invalid input with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: '', email: 'not-an-email', password: '123' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('logs in with correct password, rejects wrong password', async () => {
    await registerUser('login@test.co');
    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'login@test.co', password: 'secret123' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().token).toBeTruthy();

    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'login@test.co', password: 'wrong-pass' },
    });
    expect(bad.statusCode).toBe(401);
  });

  it('serves /api/me with a valid token and 401 without', async () => {
    const { token } = await registerUser('me@test.co');
    const ok = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${token}` } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.email).toBe('me@test.co');

    const anon = await app.inject({ method: 'GET', url: '/api/me' });
    expect(anon.statusCode).toBe(401);
  });
});

describe('nest charging', () => {
  it('recomputes cost server-side and deducts exactly once', async () => {
    const { token } = await registerUser('charge@test.co');
    const res = await app.inject({
      method: 'POST',
      url: '/api/nest/complete',
      headers: { authorization: `Bearer ${token}` },
      payload: { parts: 47, strategy: 'fast', sheets: 1, utilPct: 57.4 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cost).toBe(nestCost(47, 'fast')); // 5
    expect(body.credits).toBe(100 - body.cost);
  });

  it('returns 402 when the balance is insufficient and does not deduct', async () => {
    const { token } = await registerUser('poor@test.co');
    // Burn credits down: 13 credits per max/100-part job -> 7 jobs = 91, leaving 9.
    for (let i = 0; i < 7; i++) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/nest/complete',
        headers: { authorization: `Bearer ${token}` },
        payload: { parts: 100, strategy: 'max', sheets: 1, utilPct: 50 },
      });
      expect(r.statusCode).toBe(200);
    }
    const broke = await app.inject({
      method: 'POST',
      url: '/api/nest/complete',
      headers: { authorization: `Bearer ${token}` },
      payload: { parts: 100, strategy: 'max', sheets: 1, utilPct: 50 },
    });
    expect(broke.statusCode).toBe(402);
    expect(broke.json().credits).toBe(9); // unchanged

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.json().user.credits).toBe(9);
  });

  it('rejects a charge without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/nest/complete',
      payload: { parts: 10, strategy: 'fast', sheets: 1, utilPct: 10 },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('admin', () => {
  async function adminToken(): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { username: 'admin', password: 'admin-pass' },
    });
    expect(res.statusCode).toBe(200);
    return res.json().token;
  }

  it('rejects wrong admin credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { username: 'admin', password: 'nope' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('overview requires an admin token (user token is rejected)', async () => {
    const { token } = await registerUser('user-not-admin@test.co');
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/overview',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns stats, users, usage and can adjust credits', async () => {
    const { user } = await registerUser('adjust@test.co');
    const token = await adminToken();
    const overview = await app.inject({
      method: 'GET',
      url: '/api/admin/overview',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(overview.statusCode).toBe(200);
    const body = overview.json();
    expect(body.stats.users).toBeGreaterThan(0);
    expect(Array.isArray(body.users)).toBe(true);
    expect(Array.isArray(body.usage)).toBe(true);

    const adj = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${user.id}/credits`,
      headers: { authorization: `Bearer ${token}` },
      payload: { delta: 50 },
    });
    expect(adj.statusCode).toBe(200);
    expect(adj.json().credits).toBe(150);

    // Never below zero.
    const drain = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${user.id}/credits`,
      headers: { authorization: `Bearer ${token}` },
      payload: { delta: -100000 },
    });
    expect(drain.json().credits).toBe(0);
  });
});
