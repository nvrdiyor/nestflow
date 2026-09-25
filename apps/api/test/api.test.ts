import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { nestCost } from '../src/credits.js';
import { ConvertError, svgFromCdrXhtml } from '../src/convert.js';

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
  const admin = (
    await app.inject({ method: 'POST', url: '/api/admin/login', payload: { username: 'admin', password: 'admin-pass' } })
  ).json().token;
  await app.inject({
    method: 'PUT',
    url: '/api/admin/settings',
    headers: { authorization: `Bearer ${admin}` },
    payload: { proPrice: 70000, vipPrice: 150000, proMonthlyCredits: 10000, freeNests: 3, trialDays: 0, salesContact: 'dior_react' },
  });
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
  it('charges one credit per letter / part', () => {
    expect(nestCost(10)).toBe(10);
    expect(nestCost(47)).toBe(47);
    expect(nestCost(2000)).toBe(2000);
    expect(nestCost(0)).toBe(1);
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
    expect(body.cost).toBe(nestCost(47)); // 1 credit per letter
    expect(body.credits).toBe(100 - body.cost);
  });

  it('uses credits, then the free nests, then answers 402 without deducting', async () => {
    const { token } = await registerUser('poor@test.co');
    const job = (parts: number) =>
      app.inject({
        method: 'POST',
        url: '/api/nest/complete',
        headers: { authorization: `Bearer ${token}` },
        payload: { parts, strategy: 'max', sheets: 1, utilPct: 50 },
      });
    const paid = await job(91); // 100 starting credits -> 9 left
    expect(paid.json().cost).toBe(91);
    // Too big for the 9 credits: the 3 complimentary nests carry it.
    for (let i = 0; i < 3; i++) {
      const r = await job(100);
      expect(r.statusCode).toBe(200);
      expect(r.json().cost).toBe(0);
      expect(r.json().user.freeLeft).toBe(2 - i);
    }
    const broke = await job(100);
    expect(broke.statusCode).toBe(402);
    expect(broke.json().code).toBe('no_credits');
    expect(broke.json().credits).toBe(9); // unchanged

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.json().user.credits).toBe(9);
    expect(me.json().user.plan).toBe('free');
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
    expect((await tgApp.inject({ method: 'GET', url: '/api/config' })).json()).toMatchObject({ telegramBot: 'tasviraiauthbot' });
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

describe('plans managed from the admin panel', () => {
  let planApp: FastifyInstance;
  let adminToken = '';
  beforeAll(async () => {
    planApp = await buildServer({
      dbFile: ':memory:',
      jwtSecret: 'test-secret',
      adminUsername: 'boss',
      adminPassword: 'boss-pass',
      webDist: '',
    });
    await planApp.ready();
    adminToken = (
      await planApp.inject({ method: 'POST', url: '/api/admin/login', payload: { username: 'boss', password: 'boss-pass' } })
    ).json().token;
  });
  afterAll(async () => {
    await planApp.close();
  });
  const newUser = async (email: string) =>
    (
      await planApp.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { name: 'Shop', email, password: 'secret123' },
      })
    ).json() as { token: string; user: { id: string; credits: number; freeLeft: number; plan: string } };
  const nestJob = (token: string, parts: number) =>
    planApp.inject({
      method: 'POST',
      url: '/api/nest/complete',
      headers: { authorization: `Bearer ${token}` },
      payload: { parts, strategy: 'max', sheets: 1, utilPct: 60 },
    });
  const grant = (id: string, plan: string, months = 1) =>
    planApp.inject({
      method: 'POST',
      url: `/api/admin/users/${id}/plan`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { plan, months },
    });

  it('gives a new account a 7-day unlimited trial', async () => {
    const { token, user } = await newUser('trial@test.co') as { token: string; user: { credits: number; vip: boolean; plan: string; trialUntil: number } };
    expect(user.credits).toBe(0);
    expect(user.plan).toBe('free');
    expect(user.vip).toBe(true);
    const days = (user.trialUntil - Date.now()) / (24 * 3600 * 1000);
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
    for (let i = 0; i < 5; i++) expect((await nestJob(token, 2000)).json().cost).toBe(0);
    const cfg = (await planApp.inject({ method: 'GET', url: '/api/config' })).json();
    expect(cfg).toMatchObject({ trialDays: 7, freeNests: 0, plans: { pro: { price: 70000 }, vip: { price: 150000 } } });
  });

  it('PRO adds monthly credits spent per letter; VIP is unlimited; revoking returns to free', async () => {
    const { token, user } = await newUser('pro@test.co');
    const pro = (await grant(user.id, 'pro', 2)).json().user;
    expect(pro.plan).toBe('pro');
    expect(pro.credits).toBe(20_000);
    expect(pro.planUntil).toBeGreaterThan(Date.now() + 59 * 24 * 3600 * 1000);
    const spent = (await nestJob(token, 500)).json();
    expect(spent.cost).toBe(500);
    expect(spent.credits).toBe(19_500);

    const vip = (await grant(user.id, 'vip')).json().user;
    expect(vip.plan).toBe('vip');
    expect(vip.vip).toBe(true);
    const free = (await nestJob(token, 50_000)).json();
    expect(free.cost).toBe(0);
    expect(free.credits).toBe(19_500);

    const revoked = (await grant(user.id, 'free')).json().user;
    expect(revoked.plan).toBe('free');
    expect(revoked.vip).toBe(true); // a brand-new account is still inside its trial
  });

  it('saves plan settings and publishes them in /api/config', async () => {
    const saved = await planApp.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { proPrice: 70000, vipPrice: 150000, proMonthlyCredits: 12000, freeNests: 5, trialDays: 0, salesContact: '@dior_react' },
    });
    expect(saved.statusCode).toBe(200);
    const cfg = (await planApp.inject({ method: 'GET', url: '/api/config' })).json();
    expect(cfg).toMatchObject({
      plans: { pro: { price: 70000, credits: 12000 }, vip: { price: 150000 } },
      freeNests: 5,
      trialDays: 0,
      salesContact: 'dior_react',
    });
    // Trial switched off: a new account is limited to the complimentary nests.
    const { token, user } = await newUser('five@test.co');
    expect(user.freeLeft).toBe(5);
    expect(user.vip).toBe(false);
    for (let i = 0; i < 5; i++) expect((await nestJob(token, 300)).json().cost).toBe(0);
    expect((await nestJob(token, 300)).statusCode).toBe(402);
  });

  it('refuses plan changes without an admin token', async () => {
    const { token, user } = await newUser('sneaky@test.co');
    const res = await planApp.inject({
      method: 'POST',
      url: `/api/admin/users/${user.id}/plan`,
      headers: { authorization: `Bearer ${token}` },
      payload: { plan: 'vip', months: 12 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('keeps the admin panel locked when no admin password is configured', async () => {
    const locked = await buildServer({ dbFile: ':memory:', jwtSecret: 'x', adminUsername: 'boss', adminPassword: '', webDist: '' });
    const res = await locked.inject({ method: 'POST', url: '/api/admin/login', payload: { username: 'boss', password: 'x' } });
    expect(res.statusCode).toBe(401);
    await locked.close();
  });
});

describe('period discounts', () => {
  it('publishes the 6 / 12-month discounts and lets the admin change them', async () => {
    const dApp = await buildServer({ dbFile: ':memory:', jwtSecret: 'x', adminUsername: 'boss', adminPassword: 'pw', webDist: '' });
    expect((await dApp.inject({ method: 'GET', url: '/api/config' })).json().discounts).toEqual({ '6': 10, '12': 20 });
    const token = (
      await dApp.inject({ method: 'POST', url: '/api/admin/login', payload: { username: 'boss', password: 'pw' } })
    ).json().token;
    const saved = await dApp.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { proPrice: 150000, vipPrice: 300000, proMonthlyCredits: 10000, freeNests: 3, salesContact: 'dior_react', discount6: 15, discount12: 25 },
    });
    expect(saved.json()).toMatchObject({ discount6: 15, discount12: 25 });
    expect((await dApp.inject({ method: 'GET', url: '/api/config' })).json().discounts).toEqual({ '6': 15, '12': 25 });
    await dApp.close();
  });
});

describe('file conversion', () => {
  let conv: Awaited<ReturnType<typeof buildServer>>;
  let token = '';
  const calls: string[] = [];
  beforeAll(async () => {
    conv = await buildServer({
      dbFile: ':memory:',
      jwtSecret: 'conv-secret',
      adminUsername: 'admin',
      adminPassword: 'pw',
      converter: async (input, kind) => {
        calls.push(kind);
        if (input.includes('BROKEN')) throw new ConvertError('failed', 'bad file');
        return kind === 'dwg'
          ? { format: 'dxf', text: '0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF', pages: 1 }
          : { format: 'svg', text: '<svg xmlns="http://www.w3.org/2000/svg"/>', pages: 3 };
      },
    });
    const r = await conv.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'conv@example.com', password: 'secret123', name: 'Conv' } });
    token = r.json().token;
  });
  afterAll(async () => conv.close());
  const post = (body: Buffer | string, name: string, auth = true) =>
    conv.inject({
      method: 'POST',
      url: `/api/convert?name=${encodeURIComponent(name)}`,
      headers: { 'content-type': 'application/octet-stream', ...(auth ? { authorization: `Bearer ${token}` } : {}) },
      payload: typeof body === 'string' ? Buffer.from(body, 'latin1') : body,
    });

  it('needs a signed-in user', async () => {
    expect((await post('%PDF-1.7 x', 'a.pdf', false)).statusCode).toBe(401);
  });

  it('recognises formats by their bytes and converts them', async () => {
    const pdf = await post('%PDF-1.7\n...', 'logo.ai');
    expect(pdf.statusCode).toBe(200);
    expect(pdf.json()).toMatchObject({ kind: 'pdf', format: 'svg', pages: 3 });
    expect((await post('%!PS-Adobe-3.0 EPSF-3.0', 'x.eps')).json().kind).toBe('ps');
    expect((await post('AC1032 dwg', 'plan.dwg')).json()).toMatchObject({ kind: 'dwg', format: 'dxf' });
    expect((await post('RIFF\0\0\0\0CDRvvers', 'sign.cdr')).json().kind).toBe('cdr');
    expect((await post('PK\x03\x04 zip', 'sign.cdr')).json().kind).toBe('cdr');
    expect(calls).toEqual(['pdf', 'ps', 'dwg', 'cdr', 'cdr']);
  });

  it('refuses unknown data and reports failed conversions', async () => {
    expect((await post('hello world', 'notes.txt')).statusCode).toBe(415);
    expect((await post('PK\x03\x04 zip', 'archive.zip')).statusCode).toBe(415);
    expect((await post('%PDF-1.4 BROKEN', 'bad.pdf')).statusCode).toBe(422);
    expect((await post(Buffer.alloc(0), 'empty.pdf')).statusCode).toBe(400);
  });

  it('extracts the first page of a CorelDRAW XHTML dump as plain SVG', () => {
    const x = '<html xmlns:svg="http://www.w3.org/2000/svg"><body><svg:svg width="2in" height="1in" viewBox="0 0 2 1"><svg:path d="M0 0L1 0L1 1Z"/></svg:svg><svg:svg><svg:rect/></svg:svg></body></html>';
    const page = svgFromCdrXhtml(x)!;
    expect(page.pages).toBe(2);
    expect(page.svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="2in"');
    expect(page.svg).toContain('<path d="M0 0L1 0L1 1Z"/></svg>');
    expect(page.svg).not.toContain('svg:');
  });
});

describe('public stats', () => {
  it('reports real totals without any personal data', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats' });
    expect(res.statusCode).toBe(200);
    const s = res.json();
    expect(Object.keys(s).sort()).toEqual(['nests', 'parts', 'users']);
    expect(s.users).toBeGreaterThan(0);
    expect(s.parts).toBeGreaterThanOrEqual(s.nests);
  });
});

describe('charge moment setting', () => {
  it('defaults to charging each nest and can switch to paid downloads', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/config' })).json().chargeOn).toBe('nest');
    const login = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { username: 'admin', password: 'admin-pass' } });
    const admin = { authorization: `Bearer ${login.json().token}` };
    const bad = await app.inject({ method: 'PUT', url: '/api/admin/settings', headers: admin, payload: { proPrice: 1, vipPrice: 1, proMonthlyCredits: 1, freeNests: 3, salesContact: 'dior_react', chargeOn: 'later' } });
    expect(bad.statusCode).toBe(400);
    const cur = (await app.inject({ method: 'GET', url: '/api/admin/settings', headers: admin })).json();
    const ok = await app.inject({ method: 'PUT', url: '/api/admin/settings', headers: admin, payload: { ...cur, chargeOn: 'export' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().chargeOn).toBe('export');
    expect((await app.inject({ method: 'GET', url: '/api/config' })).json().chargeOn).toBe('export');
    // Other keys keep their values; switching back works.
    const back = await app.inject({ method: 'PUT', url: '/api/admin/settings', headers: admin, payload: { ...cur, chargeOn: 'nest' } });
    expect(back.json()).toMatchObject({ ...cur, chargeOn: 'nest' });
  });
});
