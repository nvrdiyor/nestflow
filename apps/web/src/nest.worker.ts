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
 * intersect by more than 0.5mm². A healthy layout always returns 0 (spacing
 * keeps parts apart); a non-zero count means the imported geometry is
 * inconsistent and the UI must warn instead of presenting a silently broken
 * layout. A uniform grid keeps it near-linear, so it runs for every job size.
 */
function countOverlaps(result: NestResult, parts: Part[], heartbeat: () => void): number {
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
  let sizeSum = 0;
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
    sizeSum += Math.max(maxX - minX, maxY - minY);
  }
  if (placed.length < 2) return 0;
  const cell = Math.max(1, sizeSum / placed.length);
  const grid = new Map<string, number[]>();
  placed.forEach((it, i) => {
    for (let gx = Math.floor(it.minX / cell); gx <= Math.floor(it.maxX / cell); gx++) {
      for (let gy = Math.floor(it.minY / cell); gy <= Math.floor(it.maxY / cell); gy++) {
        const key = `${it.sheet}:${gx}:${gy}`;
        const list = grid.get(key);
        if (list) list.push(i);
        else grid.set(key, [i]);
      }
    }
  });
  const tested = new Set<number>();
  let count = 0;
  let work = 0;
  for (const list of grid.values()) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const i = list[x]!;
        const j = list[y]!;
        const pairKey = i < j ? i * placed.length + j : j * placed.length + i;
        if (tested.has(pairKey)) continue;
        tested.add(pairKey);
        const a = placed[i]!;
        const b = placed[j]!;
        if (a.maxX <= b.minX || b.maxX <= a.minX || a.maxY <= b.minY || b.maxY <= a.minY) continue;
        if (regionArea(intersection(a.region, b.region)) > 0.5) count++;
        if ((++work & 63) === 0) heartbeat();
      }
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
    const overlaps = countOverlaps(result, parts, () => post({ progress: 99 }));
    post({ result: { ...result, config: cleanConfig }, overlaps });
  } catch (err) {
    post({ error: err instanceof Error ? err.message : String(err) });
  }
};
