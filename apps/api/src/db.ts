import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Loaded via createRequire so bundler-based runners (vitest/vite) don't try to
// resolve the prefix-only `node:sqlite` builtin, which is absent from
// `builtinModules` and trips their resolver. Plain `node` is unaffected.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

/**
 * Data layer on Node's built-in SQLite (node:sqlite, Node >= 22.5). Zero native
 * dependencies, a single WAL-mode file on disk — ideal for a single-node
 * deployment. All balance changes go through atomic conditional UPDATEs so
 * concurrent requests can never overdraw an account.
 */

export interface UserRow {
  id: string;
  email: string;
  name: string;
  pass_hash: string;
  credits: number;
  created_at: number;
  last_active: number;
  nests: number;
}

export interface UsageRow {
  id: string;
  user_id: string;
  at: number;
  parts: number;
  strategy: string;
  cost: number;
  sheets: number;
  util_pct: number;
}

export function randomId(): string {
  return randomBytes(9).toString('hex');
}

export class Db {
  private readonly db: DatabaseSyncType;

  constructor(file: string) {
    // A custom DB_FILE may point outside DATA_DIR; SQLite won't create dirs.
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        pass_hash TEXT NOT NULL,
        credits INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_active INTEGER NOT NULL,
        nests INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS usage (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        at INTEGER NOT NULL,
        parts INTEGER NOT NULL,
        strategy TEXT NOT NULL,
        cost INTEGER NOT NULL,
        sheets INTEGER NOT NULL,
        util_pct REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_usage_at ON usage(at DESC);
      CREATE INDEX IF NOT EXISTS idx_usage_user ON usage(user_id);
    `);
  }

  createUser(fields: { email: string; name: string; passHash: string; credits: number }): UserRow {
    const now = Date.now();
    const row: UserRow = {
      id: randomId(),
      email: fields.email,
      name: fields.name,
      pass_hash: fields.passHash,
      credits: fields.credits,
      created_at: now,
      last_active: now,
      nests: 0,
    };
    this.db
      .prepare(
        'INSERT INTO users (id, email, name, pass_hash, credits, created_at, last_active, nests) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(row.id, row.email, row.name, row.pass_hash, row.credits, row.created_at, row.last_active, row.nests);
    return row;
  }

  userByEmail(email: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
  }

  userById(id: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  }

  touchUser(id: string): void {
    this.db.prepare('UPDATE users SET last_active = ? WHERE id = ?').run(Date.now(), id);
  }

  /**
   * Atomically deducts `cost` if (and only if) the balance covers it, records
   * the usage row, and returns the new balance — or null when insufficient.
   */
  chargeNest(
    userId: string,
    meta: { parts: number; strategy: string; cost: number; sheets: number; utilPct: number },
  ): number | null {
    const result = this.db
      .prepare('UPDATE users SET credits = credits - ?, nests = nests + 1, last_active = ? WHERE id = ? AND credits >= ?')
      .run(meta.cost, Date.now(), userId, meta.cost);
    if (Number(result.changes) === 0) return null;
    this.db
      .prepare('INSERT INTO usage (id, user_id, at, parts, strategy, cost, sheets, util_pct) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(randomId(), userId, Date.now(), meta.parts, meta.strategy, meta.cost, meta.sheets, meta.utilPct);
    const user = this.userById(userId);
    return user ? user.credits : null;
  }

  /** Admin: adds (or removes, negative delta) credits; never below zero. */
  adjustCredits(userId: string, delta: number): number | null {
    this.db
      .prepare('UPDATE users SET credits = MAX(0, credits + ?) WHERE id = ?')
      .run(delta, userId);
    const user = this.userById(userId);
    return user ? user.credits : null;
  }

  allUsers(): UserRow[] {
    return this.db.prepare('SELECT * FROM users ORDER BY last_active DESC').all() as unknown as UserRow[];
  }

  recentUsage(limit = 50): Array<UsageRow & { email: string }> {
    return this.db
      .prepare(
        'SELECT usage.*, users.email AS email FROM usage JOIN users ON users.id = usage.user_id ORDER BY usage.at DESC LIMIT ?',
      )
      .all(limit) as unknown as Array<UsageRow & { email: string }>;
  }

  stats(): { users: number; activeToday: number; nests: number; creditsUsed: number } {
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    const users = (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
    const activeToday = (
      this.db.prepare('SELECT COUNT(*) AS n FROM users WHERE last_active >= ?').get(dayAgo) as { n: number }
    ).n;
    const nests = (this.db.prepare('SELECT COUNT(*) AS n FROM usage').get() as { n: number }).n;
    const creditsUsed = (
      this.db.prepare('SELECT COALESCE(SUM(cost), 0) AS n FROM usage').get() as { n: number }
    ).n;
    return { users, activeToday, nests, creditsUsed };
  }

  close(): void {
    this.db.close();
  }
}
