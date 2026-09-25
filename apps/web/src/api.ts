/**
 * API client for the NestFlow backend. Tokens live in localStorage; the last
 * known user is cached so views can render instantly, then refresh via me().
 * In dev, Vite proxies /api to the local API; in production the API serves the
 * app itself, so same-origin requests just work. Override with VITE_API_URL.
 */

export interface ApiUser {
  id: string;
  email: string;
  name: string;
  credits: number;
  /** Unlimited nesting right now (active VIP plan) — the server decides. */
  vip?: boolean;
  /** Plan in force: 'free' | 'pro' | 'vip'. */
  plan?: 'free' | 'pro' | 'vip';
  /** When the pro/vip plan ends (ms), 0 for free. */
  planUntil?: number;
  /** End of the free trial (ms) while it runs, else 0. */
  trialUntil?: number;
  /** Complimentary nests still available (after the trial). */
  freeLeft?: number;
  /** Linked Telegram @username ('' if it has none), null when not linked. */
  telegram?: string | null;
  nests: number;
  createdAt: number;
  lastActive: number;
}

/** Admin-editable plan settings (prices in so'm). */
export interface PlanSettings {
  proPrice: number;
  vipPrice: number;
  proMonthlyCredits: number;
  freeNests: number;
  /** Days of unlimited nesting for new accounts. */
  trialDays: number;
  salesContact: string;
  /** Percent off for 6- and 12-month purchases. */
  discount6: number;
  discount12: number;
}

/** Public server configuration. */
export interface PublicConfig {
  telegramBot: string | null;
  plans: { pro: { price: number; credits: number }; vip: { price: number } };
  freeNests: number;
  trialDays: number;
  salesContact: string;
  /** Percent off by period length in months, e.g. { '6': 10, '12': 20 }. */
  discounts: Record<string, number>;
}

export interface AdminOverview {
  stats: { users: number; activeToday: number; nests: number; creditsUsed: number };
  users: ApiUser[];
  settings: PlanSettings;
  usage: Array<{
    at: number;
    email: string;
    name: string;
    telegram: string | null;
    parts: number;
    strategy: string;
    cost: number;
    sheets: number;
    utilPct: number;
  }>;
}

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const K_TOKEN = 'nf_token';
const K_ADMIN_TOKEN = 'nf_admin_token';
const K_USER = 'nf_user';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: { method?: string; body?: unknown; admin?: boolean } = {}): Promise<T> {
  const token = options.admin ? localStorage.getItem(K_ADMIN_TOKEN) : localStorage.getItem(K_TOKEN);
  // A hung request must never freeze the app (the nest flow awaits the charge
  // with the UI locked) — abort after 25s and surface a normal error instead.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 25_000);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: abort.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    throw new ApiError((body.error as string) ?? `Request failed (${res.status})`, res.status, body);
  }
  return body as T;
}

function cacheUser(user: ApiUser): void {
  localStorage.setItem(K_USER, JSON.stringify(user));
}

/** Last known user — instant, may be stale; refresh with me(). */
export function cachedUser(): ApiUser | null {
  try {
    const raw = localStorage.getItem(K_USER);
    return raw ? (JSON.parse(raw) as ApiUser) : null;
  } catch {
    return null;
  }
}

export function isLoggedIn(): boolean {
  return !!localStorage.getItem(K_TOKEN);
}

/** A pending Telegram confirmation: open `link`, press START, type the bot's code. */
export interface TgChallenge {
  nonce: string;
  bot: string;
  link: string;
  expiresIn: number;
}

const FALLBACK_CONFIG: PublicConfig = {
  telegramBot: null,
  plans: { pro: { price: 70_000, credits: 10_000 }, vip: { price: 150_000 } },
  freeNests: 0,
  trialDays: 7,
  salesContact: 'dior_react',
  discounts: { '6': 10, '12': 20 },
};

let configPromise: Promise<PublicConfig> | null = null;

/** Public server configuration (cached; a failure falls back to the defaults). */
export function getConfig(): Promise<PublicConfig> {
  configPromise ??= request<PublicConfig>('/api/config')
    .then((c) => ({ ...FALLBACK_CONFIG, ...c }))
    .catch(() => {
      configPromise = null;
      return FALLBACK_CONFIG;
    });
  return configPromise;
}

/**
 * Email sign-up. With Telegram configured the server answers with a pending
 * confirmation instead of an account — finish it with telegramVerify().
 */
export async function register(
  name: string,
  email: string,
  password: string,
): Promise<{ user: ApiUser } | { pending: TgChallenge }> {
  const res = await request<({ token: string; user: ApiUser } & { pending?: false }) | ({ pending: true } & TgChallenge)>(
    '/api/auth/register',
    { method: 'POST', body: { name, email, password } },
  );
  if (res.pending) return { pending: { nonce: res.nonce, bot: res.bot, link: res.link, expiresIn: res.expiresIn } };
  localStorage.setItem(K_TOKEN, res.token);
  cacheUser(res.user);
  return { user: res.user };
}

/** Starts "Continue with Telegram". */
export function telegramStart(): Promise<TgChallenge> {
  return request<TgChallenge>('/api/auth/telegram/start', { method: 'POST', body: {} });
}

/** Finishes a Telegram confirmation with the 6-digit code from the bot; signs in. */
export async function telegramVerify(nonce: string, code: string): Promise<ApiUser> {
  const { token, user } = await request<{ token: string; user: ApiUser }>('/api/auth/telegram/verify', {
    method: 'POST',
    body: { nonce, code },
  });
  localStorage.setItem(K_TOKEN, token);
  cacheUser(user);
  return user;
}

export async function login(email: string, password: string): Promise<ApiUser> {
  const { token, user } = await request<{ token: string; user: ApiUser }>('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  localStorage.setItem(K_TOKEN, token);
  cacheUser(user);
  return user;
}

export function logout(): void {
  localStorage.removeItem(K_TOKEN);
  localStorage.removeItem(K_USER);
}

/** Fetches the fresh user; clears the session on 401. */
export async function me(): Promise<ApiUser | null> {
  if (!isLoggedIn()) return null;
  try {
    const { user } = await request<{ user: ApiUser }>('/api/me');
    cacheUser(user);
    return user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) logout();
    throw err;
  }
}

/** Reports a completed nest; the server prices and deducts. Returns new balance. */
export async function completeNest(meta: {
  parts: number;
  strategy: string;
  sheets: number;
  utilPct: number;
}): Promise<{ cost: number; credits: number; user?: ApiUser }> {
  const res = await request<{ ok: boolean; cost: number; credits: number; user?: ApiUser }>('/api/nest/complete', {
    method: 'POST',
    body: meta,
  });
  const user = cachedUser();
  if (res.user) cacheUser(res.user);
  else if (user) cacheUser({ ...user, credits: res.credits, nests: user.nests + 1 });
  return res;
}

// ---------- admin ----------

export function isAdmin(): boolean {
  return !!localStorage.getItem(K_ADMIN_TOKEN);
}

export async function adminLogin(username: string, password: string): Promise<void> {
  const { token } = await request<{ token: string }>('/api/admin/login', {
    method: 'POST',
    body: { username, password },
  });
  localStorage.setItem(K_ADMIN_TOKEN, token);
}

export function adminLogout(): void {
  localStorage.removeItem(K_ADMIN_TOKEN);
}

export async function adminOverview(): Promise<AdminOverview> {
  try {
    return await request<AdminOverview>('/api/admin/overview', { admin: true });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) adminLogout();
    throw err;
  }
}

/** Grants (plan 'pro' | 'vip', for `months`) or revokes ('free') a user's plan. */
export async function adminSetPlan(userId: string, plan: 'free' | 'pro' | 'vip', months = 1): Promise<ApiUser> {
  const { user } = await request<{ user: ApiUser }>(`/api/admin/users/${userId}/plan`, {
    method: 'POST',
    body: { plan, months },
    admin: true,
  });
  return user;
}

export async function adminSaveSettings(settings: PlanSettings): Promise<PlanSettings> {
  const saved = await request<PlanSettings>('/api/admin/settings', { method: 'PUT', body: settings, admin: true });
  configPromise = null; // prices changed — refetch the public config
  return saved;
}

export async function adminAdjustCredits(userId: string, delta: number): Promise<number> {
  const { credits } = await request<{ credits: number }>(`/api/admin/users/${userId}/credits`, {
    method: 'POST',
    body: { delta },
    admin: true,
  });
  return credits;
}
