import type { BandProfile } from './profile.js';

const EPS = 1e-7;

/**
 * Array-backed segment tree answering "first index ≥ from whose value passes
 * a threshold" in O(log n). `max` trees find values ≥ t, `min` trees values ≤ t.
 */
class SegTree {
  readonly t: Float64Array;
  readonly leaves: number;
  constructor(
    readonly n: number,
    readonly isMax: boolean,
    init: number,
  ) {
    let leaves = 1;
    while (leaves < Math.max(1, n)) leaves *= 2;
    this.leaves = leaves;
    const pad = isMax ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    this.t = new Float64Array(2 * leaves).fill(pad);
    for (let i = 0; i < n; i++) this.t[leaves + i] = init;
    for (let i = leaves - 1; i >= 1; i--) this.t[i] = this.pick(this.t[2 * i]!, this.t[2 * i + 1]!);
  }

  private pick(a: number, b: number): number {
    return this.isMax ? (a > b ? a : b) : a < b ? a : b;
  }

  private ok(v: number, thr: number): boolean {
    return this.isMax ? v >= thr : v <= thr;
  }

  set(i: number, v: number): void {
    const t = this.t;
    let node = this.leaves + i;
    t[node] = v;
    for (node >>= 1; node >= 1; node >>= 1) {
      const m = this.pick(t[2 * node]!, t[2 * node + 1]!);
      if (t[node] === m) break;
      t[node] = m;
    }
  }

  /** Smallest index ≥ from whose value passes `thr` (n if none). */
  firstFrom(from: number, thr: number): number {
    if (from >= this.n) return this.n;
    if (from < 0) from = 0;
    const t = this.t;
    let node = this.leaves + from;
    if (this.ok(t[node]!, thr)) return from;
    for (;;) {
      if (node === 1) return this.n;
      if ((node & 1) === 0 && this.ok(t[node + 1]!, thr)) {
        node = node + 1;
        break;
      }
      node >>= 1;
    }
    while (node < this.leaves) node = this.ok(t[2 * node]!, thr) ? 2 * node : 2 * node + 1;
    const i = node - this.leaves;
    return i < this.n ? i : this.n;
  }
}

/**
 * Occupancy of one sheet on the band grid: per band, the sorted disjoint
 * x-intervals already taken by placed parts (their clearance-grown shapes).
 * Parts only ever get added, so every query's answer is monotone over time —
 * which the placer exploits to resume searches where they last stopped.
 *
 * Each band's widest free gap is kept in a segment tree so packed regions
 * are skipped in O(log K) instead of band by band.
 */
export class BandSheet {
  /** Per band: flat [l0, r0, l1, r1, …], sorted, disjoint (touching runs merged). */
  readonly bands: number[][];
  /** Per band: the widest free gap inside [xMin, xMax]. */
  readonly maxGap: Float64Array;
  private readonly gapTree: SegTree;
  /** Σ cell area of the parts placed on this sheet. */
  usedCellArea = 0;

  constructor(
    readonly bandCount: number,
    readonly xMin: number,
    readonly xMax: number,
  ) {
    this.bands = new Array(bandCount);
    for (let k = 0; k < bandCount; k++) this.bands[k] = [];
    this.maxGap = new Float64Array(bandCount).fill(xMax - xMin);
    this.gapTree = new SegTree(bandCount, true, xMax - xMin);
  }

  /**
   * Smallest band k' ≥ k at which every probe interval of p finds a free gap
   * at least as wide as itself in its band — a necessary condition for a fit
   * (bandCount if none). Jumps use the gap tree, so packed regions cost O(log K).
   */
  nextCandidateBand(p: BandProfile, k: number): number {
    const limit = this.bandCount - p.rows;
    const { probeRow, probeW } = p;
    for (let changed = true; changed; ) {
      changed = false;
      if (k > limit) return this.bandCount;
      for (let t = 0; t < probeRow.length; t++) {
        const j = probeRow[t]!;
        const kk = this.gapTree.firstFrom(k + j, probeW[t]! - EPS) - j;
        if (kk > k) {
          k = kk;
          changed = true;
          if (k > limit) return this.bandCount;
        }
      }
    }
    return k;
  }

  /**
   * Leftmost translation tx ∈ [txLo, txHi] at which profile `p`, occupying
   * bands k … k+rows-1, overlaps nothing — or NaN when none exists. Every move
   * is the minimal shift that clears one specific blocking interval, so the
   * first collision-free tx found is exactly the leftmost feasible one.
   */
  fitX(p: BandProfile, k: number, txLo: number, txHi: number): number {
    if (txLo > txHi + EPS) return Number.NaN;
    let tx = txLo;
    const { off, iv, order, rows } = p;
    const bands = this.bands;
    let clean = 0;
    let i = 0;
    while (clean < rows) {
      const j = order[i]!;
      i = i + 1 === rows ? 0 : i + 1;
      const band = bands[k + j]!;
      const n = band.length >> 1;
      let moved = false;
      if (n > 0) {
        const qEnd = off[j + 1]!;
        for (let q = off[j]!; q < qEnd; q++) {
          const a = iv[2 * q]!;
          const b = iv[2 * q + 1]!;
          // First occupied interval whose right end lies beyond a + tx.
          const x = a + tx + EPS;
          let lo = 0;
          let hi = n;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (band[2 * mid + 1]! > x) hi = mid;
            else lo = mid + 1;
          }
          while (lo < n && band[2 * lo]! < b + tx - EPS) {
            tx = band[2 * lo + 1]! - a;
            if (tx > txHi + EPS) return Number.NaN;
            moved = true;
            lo++;
          }
        }
      }
      if (moved) clean = 0;
      else clean++;
    }
    return tx;
  }

  /** Marks profile `p` at (k, tx) as occupied. */
  insert(p: BandProfile, k: number, tx: number): void {
    const { off, iv, rows } = p;
    for (let j = 0; j < rows; j++) {
      const qEnd = off[j + 1]!;
      if (off[j]! === qEnd) continue;
      const kb = k + j;
      const band = this.bands[kb]!;
      for (let q = off[j]!; q < qEnd; q++) insertInterval(band, iv[2 * q]! + tx, iv[2 * q + 1]! + tx);
      let widest = 0;
      let cursor = this.xMin;
      for (let i = 0; i < band.length; i += 2) {
        const gap = band[i]! - cursor;
        if (gap > widest) widest = gap;
        if (band[i + 1]! > cursor) cursor = band[i + 1]!;
      }
      if (this.xMax - cursor > widest) widest = this.xMax - cursor;
      if (widest !== this.maxGap[kb]) {
        this.maxGap[kb] = widest;
        this.gapTree.set(kb, widest);
      }
    }
    this.usedCellArea += p.cellArea;
  }
}

function insertInterval(band: number[], l: number, r: number): void {
  const n = band.length >> 1;
  // First interval whose right end reaches l (touching merges).
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (band[2 * mid + 1]! >= l - EPS) hi = mid;
    else lo = mid + 1;
  }
  let end = lo;
  let nl = l;
  let nr = r;
  while (end < n && band[2 * end]! <= r + EPS) {
    if (band[2 * end]! < nl) nl = band[2 * end]!;
    if (band[2 * end + 1]! > nr) nr = band[2 * end + 1]!;
    end++;
  }
  band.splice(2 * lo, 2 * (end - lo), nl, nr);
}
