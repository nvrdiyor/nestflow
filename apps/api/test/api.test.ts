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

describe('VIP_ALL mode', () => {
  let vipApp: FastifyInstance;
  beforeAll(async () => {
    vipApp = await buildServer({
      dbFile: ':memory:',
      jwtSecret: 'test-secret',
      adminUsername: 'admin',
      adminPassword: 'admin-pass',
      startingCredits: 5,
      vipAll: true,
      webDist: '',
    });
    await vipApp.ready();
  });
  afterAll(async () => {
    await vipApp.close();
  });

  it('marks users VIP and nests huge jobs for free, still logging usage', async () => {
    const reg = await vipApp.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'Vip', email: 'vip@test.co', password: 'secret123' },
    });
    const { token, user } = reg.json();
    expect(user.vip).toBe(true);
    const charge = await vipApp.inject({
      method: 'POST',
      url: '/api/nest/complete',
      headers: { authorization: `Bearer ${token}` },
      payload: { parts: 2000, strategy: 'max', sheets: 10, utilPct: 58 },
    });
    expect(charge.statusCode).toBe(200);
    expect(charge.json().cost).toBe(0);
    expect(charge.json().credits).toBe(5); // nothing deducted
    const admin = await vipApp.inject({ method: 'POST', url: '/api/admin/login', payload: { username: 'admin', password: 'admin-pass' } });
    const overview = await vipApp.inject({
      method: 'GET',
      url: '/api/admin/overview',
      headers: { authorization: `Bearer ${admin.json().token}` },
    });
    expect(overview.json().usage[0].parts).toBe(2000);
  });
});

describe('Telegram sign-in and sign-up confirmation', () => {
  let tgApp: FastifyInstance;
  const sent: Array<{ chat: string; text: string }> = [];
  const fakeBot = {
    async sendMessage(chatId: number | string, text: string) {
      sent.push({ chat: String(chatId), text });
    },
  };
  const tgUser = (id: number, extra: Record<string, unknown> = {}) => ({
    id,
    first_name: 'Ali',
    last_name: 'Valiyev',
    username: `ali${id}`,
    language_code: 'uz',
    ...extra,
  });
  let updateId = 1;
  const pressStart = async (from: ReturnType<typeof tgUser>, nonce: string): Promise<string | null> => {
    const before = sent.length;
    await tgApp.handleTelegramUpdate({
      update_id: updateId++,
      message: { message_id: updateId, chat: { id: from.id, type: 'private' }, from, text: `/start ${nonce}` },
    });
    const reply = sent.slice(before).find((m) => m.chat === String(from.id));
    return reply ? (/<code>(\d{6})<\/code>/.exec(reply.text)?.[1] ?? null) : null;
  };
  const verify = (nonce: string, code: string) =>
    tgApp.inject({ method: 'POST', url: '/api/auth/telegram/verify', payload: { nonce, code } });

  beforeAll(async () => {
    tgApp = await buildServer({
      dbFile: ':memory:',
      jwtSecret: 'test-secret',
      adminUsername: 'admin',
      adminPassword: 'admin-pass',
      startingCredits: 100,
      webDist: '',
      telegram: { sender: fakeBot, botUsername: 'tasviraiauthbot', siteUrl: 'https://tasvirai.uz' },
    });
    await tgApp.ready();
  });
  afterAll(async () => {
    await tgApp.close();
  });

  it('advertises the bot in /api/config', async () => {
    expect((await tgApp.inject({ method: 'GET', url: '/api/config' })).json()).toEqual({ telegramBot: 'tasviraiauthbot' });
  });

  it('signs in with a bot code, creating the account once and reusing it after', async () => {
    const start = (await tgApp.inject({ method: 'POST', url: '/api/auth/telegram/start' })).json();
    expect(start.link).toBe(`https://t.me/tasviraiauthbot?start=${start.nonce}`);
    expect((await verify(start.nonce, '000000')).json().code).toBe('tg_not_opened');

    const code = await pressStart(tgUser(111), start.nonce);
    expect(code).toMatch(/^\d{6}$/);
    const wrong = code === '000000' ? '111111' : '000000';
    expect((await verify(start.nonce, wrong)).json().code).toBe('tg_bad_code');
    const ok = await verify(start.nonce, code!);
    expect(ok.statusCode).toBe(200);
    const first = ok.json();
    expect(first.created).toBe(true);
    expect(first.user.name).toBe('Ali Valiyev');
    expect(first.user.email).toBe(''); // placeholder address is never exposed
    expect(first.user.telegram).toBe('ali111');
    // The challenge is single-use.
    expect((await verify(start.nonce, code!)).json().code).toBe('tg_expired');

    const again = (await tgApp.inject({ method: 'POST', url: '/api/auth/telegram/start' })).json();
    const code2 = await pressStart(tgUser(111), again.nonce);
    const second = (await verify(again.nonce, code2!)).json();
    expect(second.created).toBe(false);
    expect(second.user.id).toBe(first.user.id);
    const me = await tgApp.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${second.token}` } });
    expect(me.json().user.id).toBe(first.user.id);
  });

  it('requires a Telegram code for email sign-up and links the account', async () => {
    const reg = await tgApp.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'Sardor', email: 'sardor@test.co', password: 'secret123' },
    });
    const pending = reg.json();
    expect(pending.pending).toBe(true);
    expect(pending.token).toBeUndefined(); // no account before confirmation
    const code = await pressStart(tgUser(222), pending.nonce);
    const done = (await verify(pending.nonce, code!)).json();
    expect(done.user.email).toBe('sardor@test.co');
    expect(done.user.telegram).toBe('ali222');
    // The password works afterwards.
    const login = await tgApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'sardor@test.co', password: 'secret123' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('refuses a second sign-up from the same Telegram account', async () => {
    const pending = (
      await tgApp.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { name: 'Spam', email: 'spam@test.co', password: 'secret123' },
      })
    ).json();
    expect(await pressStart(tgUser(222), pending.nonce)).toBeNull(); // bot answers "already registered", no code
    expect((await verify(pending.nonce, '123456')).json().code).toBe('tg_not_opened');
  });

  it('keeps a link bound to the first Telegram account that opened it', async () => {
    const start = (await tgApp.inject({ method: 'POST', url: '/api/auth/telegram/start' })).json();
    expect(await pressStart(tgUser(333), start.nonce)).toMatch(/^\d{6}$/);
    expect(await pressStart(tgUser(444), start.nonce)).toBeNull();
  });

  it('locks a challenge after five wrong codes', async () => {
    const start = (await tgApp.inject({ method: 'POST', url: '/api/auth/telegram/start' })).json();
    const code = await pressStart(tgUser(555), start.nonce);
    const wrong = code === '999999' ? '888888' : '999999';
    for (let i = 0; i < 5; i++) expect((await verify(start.nonce, wrong)).statusCode).toBe(400);
    const locked = await verify(start.nonce, code!);
    expect(locked.statusCode).toBe(429);
    expect(locked.json().code).toBe('tg_attempts');
  });

  it('answers plain messages with help instead of a code', async () => {
    const before = sent.length;
    await tgApp.handleTelegramUpdate({
      update_id: updateId++,
      message: { message_id: 1, chat: { id: 666, type: 'private' }, from: tgUser(666), text: 'salom' },
    });
    expect(sent.slice(before)[0]?.text).toContain('tasvirai.uz');
  });
});
