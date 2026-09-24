/**
 * Client-side mirror of the server's pricing, used ONLY for display (the run
 * button label and the "can this job run" pre-check). The API recomputes the
 * price on every charge — see apps/api/src/credits.ts.
 *
 *   1 credit = 1 letter / part.
 */
export type Strategy = 'fast' | 'balanced' | 'max';

export function nestCost(partInstances: number): number {
  return Math.max(1, Math.ceil(partInstances));
}
