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
export function buyText(plan: 'PRO' | 'VIP', price: number, user: ApiUser | null = null): string {
  const lines = [t('plan.buyMsg', { plan, price: fmtSum(price), site: location.hostname })];
  if (user) {
    const who = `${user.name}${user.telegram ? ` (@${user.telegram})` : ''}`;
    lines.push(t('plan.buyMsgAccount', { who }));
  }
  return lines.join('\n');
}

/** The user's plan in one short line ("PRO · 12.10.2026 gacha"). */
export function planLine(user: ApiUser): string {
  const plan = user.plan ?? 'free';
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
      <div class="plans-grid">
        <div class="plan-card">
          <div class="pl-name">PRO</div>
          <div class="pl-price">${fmtSum(cfg.plans.pro.price)} <small>${t('plan.perMonth')}</small></div>
          <ul>${check(t('plan.proB1', { n: fmtSum(cfg.plans.pro.credits) }))}${check(t('plan.proB2'))}${check(t('plan.proB3'))}</ul>
          <a class="btn btn-tg pl-buy" href="${salesLink(cfg.salesContact, buyText('PRO', cfg.plans.pro.price, user))}" target="_blank" rel="noopener">✈ ${t('plan.buyPro')}</a>
        </div>
        <div class="plan-card hot">
          <div class="pl-name">VIP</div>
          <div class="pl-price">${fmtSum(cfg.plans.vip.price)} <small>${t('plan.perMonth')}</small></div>
          <ul>${check(t('plan.vipB1'))}${check(t('plan.vipB2'))}${check(t('plan.vipB3'))}</ul>
          <a class="btn btn-tg pl-buy vip" href="${salesLink(cfg.salesContact, buyText('VIP', cfg.plans.vip.price, user))}" target="_blank" rel="noopener">✈ ${t('plan.buyVip')}</a>
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
