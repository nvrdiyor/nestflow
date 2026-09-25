import { ringBounds, type Contour, type Part } from '@nestflow/engine';
import { importDxfParts } from './dxfImport';
import { importSvgParts } from './svgImport';
import type { VectorSource } from './importCommon';

/**
 * A nesting job: one or more drawings (each with its own real-size scale and
 * ignored layers) plus per-part choices — how many to cut and how a part may
 * turn. Everything is plain data, so a job survives view re-renders and is
 * stored in the history as-is.
 */

export interface JobFile {
  id: string;
  name: string;
  /** Importable text (converted when the upload was PDF / CDR / DWG…). */
  text: string;
  /** Extra mm-per-unit factor from the real-size fields (1 = as drawn). */
  scale: number;
  /** Conversion note shown with the file (e.g. "page 1 of 3"). */
  note: string;
  /** Part-id prefix: '' for the first file (old saved jobs), "fN:" after. */
  prefix: string;
  /** DXF layers not cut. */
  layersOff: string[];
}

export interface LoadedFile extends JobFile {
  parts: Part[];
  sources: Map<string, VectorSource>;
  fine: Map<string, Contour>;
  warnings: string[];
  /** Drawing size in mm at the current scale. */
  w: number;
  h: number;
  layers: Array<{ name: string; count: number }>;
  /** Source layer of each part (DXF files). */
  partLayers: Map<string, string>;
}

/** Per-part choices; missing fields follow the file / job defaults. */
export interface PartOverride {
  qty?: number;
  /** Rotation step in degrees as text ('0' none, '180', '90', '45', '15'); '' = job setting. */
  rot?: string;
}

export const ROTATION_STEPS = ['0', '180', '90', '45', '15'] as const;

/** Allowed angles for a rotation step ('0' → no turning). */
export function rotationsFor(step: string): number[] {
  const n = Number(step);
  if (!(n > 0) || n >= 360) return [0];
  return Array.from({ length: Math.round(360 / n) }, (_, i) => i * n);
}

export function isDxfText(text: string, name: string): boolean {
  if (/\.dxf$/i.test(name)) return true;
  if (/\.svg$/i.test(name) || /<svg[\s>]/i.test(text)) return false;
  return /\bENTITIES\b/.test(text) && /\bSECTION\b/.test(text);
}

/** Imports one drawing of the job (ids prefixed so several files never clash). */
export function loadJobFile(f: JobFile): LoadedFile {
  const res = isDxfText(f.text, f.name)
    ? importDxfParts(f.text, f.scale, { ignoreLayers: f.layersOff })
    : importSvgParts(f.text, f.scale);
  const pre = f.prefix;
  const parts = pre ? res.parts.map((p) => ({ ...p, id: pre + p.id })) : res.parts;
  const rekey = <T>(m: Map<string, T> | undefined): Map<string, T> => {
    const out = new Map<string, T>();
    for (const [k, v] of m ?? []) out.set(pre + k, v);
    return out;
  };
  let w = res.size?.w ?? 0;
  let h = res.size?.h ?? 0;
  if (!(w > 0)) {
    for (const p of parts) {
      const b = ringBounds(p.contour.outer);
      w = Math.max(w, b.maxX - b.minX);
      h = Math.max(h, b.maxY - b.minY);
    }
  }
  return {
    ...f,
    parts,
    sources: rekey(res.sources),
    fine: rekey(res.fineContours),
    warnings: res.warnings,
    w,
    h,
    layers: res.layers ?? [],
    partLayers: rekey(res.partLayers),
  };
}

/** Plain job data (what the history stores). */
export const jobData = (f: LoadedFile): JobFile => ({
  id: f.id,
  name: f.name,
  text: f.text,
  scale: f.scale,
  note: f.note,
  prefix: f.prefix,
  layersOff: f.layersOff,
});

/** The parts to nest: every file's parts with the per-part choices applied (quantity 0 = left out). */
export function jobParts(files: LoadedFile[], overrides: Map<string, PartOverride>): Part[] {
  const out: Part[] = [];
  for (const f of files) {
    for (const p of f.parts) {
      const o = overrides.get(p.id);
      const qty = o?.qty ?? p.quantity ?? 1;
      if (qty <= 0) continue;
      const part: Part = { ...p, quantity: qty };
      if (o?.rot) part.allowedRotations = rotationsFor(o.rot);
      out.push(part);
    }
  }
  return out;
}

export function mergedSources(files: LoadedFile[]): Map<string, VectorSource> {
  const out = new Map<string, VectorSource>();
  for (const f of files) for (const [k, v] of f.sources) out.set(k, v);
  return out;
}

export function mergedLayers(files: LoadedFile[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of files) for (const [k, v] of f.partLayers ?? []) out.set(k, v);
  return out;
}

export function mergedFine(files: LoadedFile[]): Map<string, Contour> {
  const out = new Map<string, Contour>();
  for (const f of files) for (const [k, v] of f.fine) out.set(k, v);
  return out;
}

/** Next file id / prefix for an added drawing. */
export function nextFileMeta(files: JobFile[]): { id: string; prefix: string } {
  let n = files.length + 1;
  while (files.some((f) => f.id === `f${n}`)) n++;
  return { id: `f${n}`, prefix: files.length ? `f${n}:` : '' };
}
