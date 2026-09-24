/**
 * Pricing and plans — the SERVER-side source of truth. The web client mirrors
 * the cost formula for display only; the API recomputes the cost on every
 * charge, so a tampered client cannot pay less.
 *
 *   cost = number of letters / parts in the job   (1 credit = 1 letter)
 *
 * Plans are sold by hand (the admin grants them after payment in Telegram):
 *   - free: `freeNests` complimentary nests of any size, then a plan is needed.
 *   - pro:  a monthly pack of `proMonthlyCredits`, spent per letter.
 *   - vip:  unlimited nesting while the plan is active.
 */
export type Strategy = 'fast' | 'balanced' | 'max';
export type Plan = 'free' | 'pro' | 'vip';

export const STRATEGIES: Strategy[] = ['fast', 'balanced', 'max'];
export const PLANS: Plan[] = ['free', 'pro', 'vip'];

/** One plan month, in milliseconds (plans are granted in 30-day months). */
export const PLAN_MONTH_MS = 30 * 24 * 3600 * 1000;

export function nestCost(partInstances: number): number {
  return Math.max(1, Math.ceil(partInstances));
}

/** Admin-editable business settings (prices in so'm). */
export interface PlanSettings {
  proPrice: number;
  vipPrice: number;
  proMonthlyCredits: number;
  /** Complimentary nests every account gets before it needs a plan. */
  freeNests: number;
  /** Telegram username (no @) customers write to in order to buy a plan. */
  salesContact: string;
  /** Percent off when a plan is bought for 6 / 12 months at once. */
  discount6: number;
  discount12: number;
}

export function defaultSettings(): PlanSettings {
  return {
    proPrice: 150_000,
    vipPrice: 300_000,
    proMonthlyCredits: 10_000,
    freeNests: 3,
    salesContact: 'dior_react',
    discount6: 10,
    discount12: 20,
  };
}

/** The plan in force right now (an expired pro/vip counts as free). */
export function effectivePlan(user: { plan: string; plan_until: number }, now = Date.now()): Plan {
  if ((user.plan === 'pro' || user.plan === 'vip') && user.plan_until > now) return user.plan;
  return 'free';
}
