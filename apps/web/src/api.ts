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
  nests: number;
  createdAt: number;
  lastActive: number;
}

export interface AdminOverview {
  stats: { users: number; activeToday: number; nests: number; creditsUsed: number };
  users: ApiUser[];
  usage: Array<{
    at: number;
    email: string;
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
  const res = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
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

export async function register(name: string, email: string, password: string): Promise<ApiUser> {
  const { token, user } = await request<{ token: string; user: ApiUser }>('/api/auth/register', {
    method: 'POST',
    body: { name, email, password },
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
}): Promise<{ cost: number; credits: number }> {
  const res = await request<{ ok: boolean; cost: number; credits: number }>('/api/nest/complete', {
    method: 'POST',
    body: meta,
  });
  const user = cachedUser();
  if (user) cacheUser({ ...user, credits: res.credits, nests: user.nests + 1 });
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

export async function adminAdjustCredits(userId: string, delta: number): Promise<number> {
  const { credits } = await request<{ credits: number }>(`/api/admin/users/${userId}/credits`, {
    method: 'POST',
    body: { delta },
    admin: true,
  });
  return credits;
}
