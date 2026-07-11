/**
 * Credit pricing — the SERVER-side source of truth. The web client mirrors this
 * formula for display only; the API recomputes the cost on every charge, so a
 * tampered client cannot pay less.
 *
 *   cost = strategyBase + ceil(partInstances / 15)
 */
export type Strategy = 'fast' | 'balanced' | 'max';

export const STRATEGY_BASE: Record<Strategy, number> = { fast: 1, balanced: 3, max: 6 };

export const STRATEGIES = Object.keys(STRATEGY_BASE) as Strategy[];

export function nestCost(partInstances: number, strategy: Strategy): number {
  return STRATEGY_BASE[strategy] + Math.ceil(Math.max(0, partInstances) / 15);
}
