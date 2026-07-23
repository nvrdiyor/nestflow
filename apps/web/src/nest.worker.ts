import {
  intersection,
  nest,
  placementContour,
  regionArea,
  type Contour,
  type NestConfig,
  type NestResult,
  type Part,
} from '@nestflow/engine';

/**
 * Runs the nesting engine off the main thread so the UI never freezes, even for
 * `max`-strategy jobs that take several seconds. Parts and results are plain
 * data, so they cross the worker boundary via structured clone with no fuss.
 * Search progress is forwarded as {progress: 0..100} messages (deduplicated per
 * whole percent) so the UI can count up while the engine works.
 */
export interface NestRequest {
  parts: Part[];
  config: NestConfig;
}

const post = (msg: unknown): void => (self as unknown as Worker).postMessage(msg);

/**
 * Post-nest sanity check: counts pairs of placed parts whose TRUE contours
 * intersect by more than 4mm². A healthy layout always returns 0 (spacing keeps
 * parts apart); a non-zero count means the imported geometry is inconsistent
 * and the UI must warn instead of presenting a silently broken layout.
 */
function countOverlaps(result: NestResult, parts: Part[]): number {
  if (result.placements.length > 400) return 0;
  const map = new Map(parts.map((p) => [p.id, p]));
  interface PlacedRegion {
    sheet: number;
    region: Contour[];
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }
  const placed: PlacedRegion[] = [];
  for (const pl of result.placements) {
    const part = map.get(pl.partId);
    if (!part) continue;
    const c = placementContour(part, pl);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of c.outer) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    placed.push({ sheet: pl.sheet, region: [c], minX, minY, maxX, maxY });
  }
  let count = 0;
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i]!;
      const b = placed[j]!;
      if (a.sheet !== b.sheet) continue;
      if (a.maxX <= b.minX || b.maxX <= a.minX || a.maxY <= b.minY || b.maxY <= a.minY) continue;
      if (regionArea(intersection(a.region, b.region)) > 4) count++;
    }
  }
  return count;
}

self.onmessage = (event: MessageEvent<NestRequest>) => {
  const { parts, config } = event.data;
  try {
    let lastPct = -1;
    const result = nest(parts, {
      ...config,
      onProgress: (fraction) => {
        const pct = Math.min(99, Math.round(fraction * 100));
        if (pct > lastPct) {
          lastPct = pct;
          post({ progress: pct });
        }
      },
    });
    // The engine echoes the config (incl. the onProgress function) back on the
    // result — functions can't cross the worker boundary, so strip it.
    const { onProgress: _drop, ...cleanConfig } = result.config as NestConfig & { onProgress?: unknown };
    post({ result: { ...result, config: cleanConfig }, overlaps: countOverlaps(result, parts) });
  } catch (err) {
    post({ error: err instanceof Error ? err.message : String(err) });
  }
};
