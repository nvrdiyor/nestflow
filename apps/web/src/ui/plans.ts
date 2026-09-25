import { getConfig, type ApiUser, type PublicConfig } from '../api';
import { t } from '../i18n';
import { escapeHtml } from './nav';

/** 150000 → "150 000" (so'm amounts read better grouped). */
export const fmtSum = (n: number): string => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export function fmtDay(ts: number): string {
  try {
    return new Date(ts).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return '';
  }
}

/**
 * Telegram chat link to the seller. With `text`, Telegram opens the chat with
 * that message already typed in the input box (official `t.me/<user>?text=`).
 */
export const salesLink = (contact: string, text = ''): string =>
  `https://t.me/${encodeURIComponent(contact)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

/**
 * The ready-made "I want to buy …" message for a plan. When the buyer is
 * signed in, their name and @username are added so the admin finds the
 * account in /admin at once.
 */
export function buyText(
  plan: 'PRO' | 'VIP',
  price: number,
  user: ApiUser | null = null,
  months = 1,
  off = 0,
): string {
  const params = { plan, months, off, total: fmtSum(periodTotal(price, months, off)), site: location.hostname };
  const lines = [t(off > 0 ? 'plan.buyMsgDisc' : 'plan.buyMsg', params)];
  if (user) {
    const who = `${user.name}${user.telegram ? ` (@${user.telegram})` : ''}`;
    lines.push(t('plan.buyMsgAccount', { who }));
  }
  return lines.join('\n');
}

/** Subscription periods offered to buyers (months). */
export const PERIODS = [1, 3, 6, 12];

/** Percent off for buying `months` at once (admin-set; 6 and 12 months by default). */
export const discountFor = (cfg: PublicConfig, months: number): number => cfg.discounts?.[String(months)] ?? 0;

/** Price of `months` at a monthly `price` with `off` percent discount, rounded to 1 000 so'm. */
export const periodTotal = (price: number, months: number, off: number): number =>
  off > 0 ? Math.round((price * months * (1 - off / 100)) / 1000) * 1000 : price * months;

/** Segmented 1 / 3 / 6 / 12-month picker; pair it with {@link wirePeriods}. */
export function periodPickerMarkup(): string {
  const buttons = PERIODS.map(
    (m, i) => `<button type="button" data-m="${m}" class="${i === 0 ? 'active' : ''}">${t('plan.monthsN', { n: m })}</button>`,
  ).join('');
  return `<div class="pl-period js-period" role="group" aria-label="${t('plan.periodLabel')}">${buttons}</div>`;
}

/**
 * Wires the period picker inside `scope`: every `.js-total[data-plan]` shows
 * the total for the chosen period and every `.js-buy[data-plan]` link carries
 * a Telegram draft naming the plan, the months and the total.
 */
export function wirePeriods(scope: HTMLElement, cfg: PublicConfig, user: ApiUser | null): void {
  let months = PERIODS[0]!;
  const priceOf = (plan: string | undefined): number => (plan === 'VIP' ? cfg.plans.vip.price : cfg.plans.pro.price);
  const apply = (): void => {
    const off = discountFor(cfg, months);
    scope.querySelectorAll<HTMLButtonElement>('.js-period button').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.m) === months);
    });
    scope.querySelectorAll<HTMLElement>('.js-total[data-plan]').forEach((el) => {
      const price = priceOf(el.dataset.plan);
      const total = periodTotal(price, months, off);
      const sum = off > 0 ? `<s>${fmtSum(price * months)}</s> ${fmtSum(total)}` : fmtSum(total);
      el.innerHTML = t('plan.total', { n: months, sum });
    });
    scope.querySelectorAll<HTMLAnchorElement>('.js-buy[data-plan]').forEach((a) => {
      const plan = a.dataset.plan === 'VIP' ? 'VIP' : 'PRO';
      a.href = salesLink(cfg.salesContact, buyText(plan, priceOf(plan), user, months, off));
    });
  };
  // Discount tags on the period buttons (−10%, −20%).
  scope.querySelectorAll<HTMLButtonElement>('.js-period button').forEach((b) => {
    const off = discountFor(cfg, Number(b.dataset.m));
    b.querySelector('.pl-off')?.remove();
    if (off > 0) b.insertAdjacentHTML('beforeend', ` <span class="pl-off">−${off}%</span>`);
  });
  scope.querySelectorAll<HTMLButtonElement>('.js-period button').forEach((b) => {
    b.addEventListener('click', () => {
      months = Number(b.dataset.m) || 1;
      apply();
    });
  });
  apply();
}

/** The user's plan in one short line ("PRO · 12.10.2026 gacha"). */
export function planLine(user: ApiUser): string {
  const plan = user.plan ?? 'free';
  if (plan === 'free' && (user.trialUntil ?? 0) > Date.now()) return t('plan.trialLine', { date: fmtDay(user.trialUntil!) });
  if (plan === 'free') return t('plan.free');
  const until = user.planUntil ? ` · ${t('plan.until', { date: fmtDay(user.planUntil) })}` : '';
  return `${plan.toUpperCase()}${until}`;
}

function modalMarkup(cfg: PublicConfig, user: ApiUser | null, reason: string): string {
  const contact = escapeHtml(cfg.salesContact);
  const check = (s: string): string => `<li><span class="pl-check">✓</span>${s}</li>`;
  return `
  <div class="plans-overlay js-plans-overlay" role="dialog" aria-modal="true">
    <div class="plans-modal">
      <button class="plans-x js-plans-close" aria-label="${t('plan.close')}">×</button>
      <h2>${t('plan.modalTitle')}</h2>
      ${reason ? `<div class="plans-reason">${reason}</div>` : ''}
      ${user ? `<p class="plans-current">${t('plan.current', { plan: `<b>${escapeHtml(planLine(user))}</b>` })}</p>` : ''}
      ${periodPickerMarkup()}
      <div class="plans-grid">
        <div class="plan-card">
          <div class="pl-name">PRO</div>
          <div class="pl-price">${fmtSum(cfg.plans.pro.price)} <small>${t('plan.perMonth')}</small></div>
          <div class="pl-total js-total" data-plan="PRO"></div>
          <ul>${check(t('plan.proB1', { n: fmtSum(cfg.plans.pro.credits) }))}${check(t('plan.proB2'))}${check(t('plan.proB3'))}</ul>
          <a class="btn btn-tg pl-buy js-buy" data-plan="PRO" href="${salesLink(cfg.salesContact)}" target="_blank" rel="noopener">✈ ${t('plan.buyPro')}</a>
        </div>
        <div class="plan-card hot">
          <div class="pl-name">VIP</div>
          <div class="pl-price">${fmtSum(cfg.plans.vip.price)} <small>${t('plan.perMonth')}</small></div>
          <div class="pl-total js-total" data-plan="VIP"></div>
          <ul>${check(t('plan.vipB1'))}${check(t('plan.vipB2'))}${check(t('plan.vipB3'))}</ul>
          <a class="btn btn-tg pl-buy vip js-buy" data-plan="VIP" href="${salesLink(cfg.salesContact)}" target="_blank" rel="noopener">✈ ${t('plan.buyVip')}</a>
        </div>
      </div>
      <p class="plans-sub">${t('plan.modalSub', { c: `<a href="${salesLink(cfg.salesContact)}" target="_blank" rel="noopener">@${contact}</a>` })}</p>
    </div>
  </div>`;
}

/** Opens the plans dialog (PRO / VIP + where to buy); `reason` explains why it popped up. */
export function openPlans(user: ApiUser | null, reason = ''): void {
  void getConfig().then((cfg) => {
    document.querySelector('.js-plans-overlay')?.remove();
    const host = document.createElement('div');
    host.innerHTML = modalMarkup(cfg, user, reason);
    const overlay = host.firstElementChild as HTMLElement;
    document.body.appendChild(overlay);
    wirePeriods(overlay, cfg, user);
    const close = (): void => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    overlay.querySelector('.js-plans-close')?.addEventListener('click', close);
  });
}
