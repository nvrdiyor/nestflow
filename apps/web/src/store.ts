import type { NestResult, Ring } from '@nestflow/engine';

/**
 * Local, per-browser storage of finished jobs (history) and saved remnants,
 * in IndexedDB — big DXF files and thousands of outlines don't fit the 5 MB
 * of localStorage. Every call degrades to a no-op when storage is blocked
 * (private window, disabled site data): the tool keeps working without it.
 */

export interface HistoryEntry {
  id: string;
  at: number;
  name: string;
  /** The imported file itself and the scale / mirror it was nested with. */
  text: string;
  scale: number;
  mirror: string;
  result: NestResult;
  parts: number;
  sheets: number;
  util: number;
  /** Charged already (false only in "pay to download" mode before the first download). */
  paid?: boolean;
}

export interface RemnantEntry {
  id: string;
  at: number;
  name: string;
  width: number;
  height: number;
  margin: number;
  /** 1-based number of the sheet it was left from (shown with the name). */
  sheet: number;
  blocked: Ring[];
  /** Free share of the usable sheet, 0…1. */
  free: number;
}

type StoreName = 'history' | 'remnants';

const DB_NAME = 'tasvir-ai';
const MAX_HISTORY = 20;
let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('remnants')) db.createObjectStore('remnants', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = fn(db.transaction(store, mode).objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

const newest = <T extends { at: number }>(list: T[] | null): T[] => (list ?? []).sort((a, b) => b.at - a.at);

export const newId = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export async function listHistory(): Promise<HistoryEntry[]> {
  return newest(await tx<HistoryEntry[]>('history', 'readonly', (s) => s.getAll()));
}

/** Saves (or updates) a job; only the newest {@link MAX_HISTORY} are kept. */
export async function saveHistory(entry: HistoryEntry): Promise<void> {
  await tx('history', 'readwrite', (s) => s.put(entry));
  const all = await listHistory();
  for (const old of all.slice(MAX_HISTORY)) await deleteHistory(old.id);
}

export async function deleteHistory(id: string): Promise<void> {
  await tx('history', 'readwrite', (s) => s.delete(id));
}

export async function listRemnants(): Promise<RemnantEntry[]> {
  return newest(await tx<RemnantEntry[]>('remnants', 'readonly', (s) => s.getAll()));
}

export async function saveRemnant(entry: RemnantEntry): Promise<void> {
  await tx('remnants', 'readwrite', (s) => s.put(entry));
}

export async function deleteRemnant(id: string): Promise<void> {
  await tx('remnants', 'readwrite', (s) => s.delete(id));
}
