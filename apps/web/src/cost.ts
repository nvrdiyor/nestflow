/**
 * Client-side mirror of the server's credit pricing, used ONLY for display (the
 * "Nest layout · N credits" label and landing-page examples). The API recomputes
 * the price on every charge — see apps/api/src/credits.ts.
 */
export type Strategy = 'fast' | 'balanced' | 'max';

const STRATEGY_BASE: Record<Strategy, number> = { fast: 1, balanced: 3, max: 6 };

export const STARTING_CREDITS = 100;

export function nestCost(partInstances: number, strategy: Strategy): number {
  return STRATEGY_BASE[strategy] + Math.ceil(Math.max(0, partInstances) / 15);
}
