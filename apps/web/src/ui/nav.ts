import type { ApiUser } from '../api';
import { langSwitchMarkup, t } from '../i18n';

const LOGO = (): string => `<span class="logo">◧</span><div>Tasvir&nbsp;AI<small>${t('brand.tag')}</small></div>`;

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? '';
  const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (a + b).toUpperCase() || '?';
}

/**
 * The plan pill in the app nav — VIP ∞, PRO with its credits, or the free
 * nests left. It is a button: clicking it opens the plans dialog.
 */
export function pillMarkup(user: ApiUser): string {
  if (user.vip) return `<button class="credits-pill vip js-plans" type="button" title="VIP"><b>VIP</b> ∞</button>`;
  if (user.plan === 'pro') {
    const low = user.credits <= 100 ? ' low' : '';
    return `<button class="credits-pill pro${low} js-plans" type="button"><b>PRO</b> · ${user.credits} ${t('nav.credits')}</button>`;
  }
  if (user.credits > 0) {
    return `<button class="credits-pill js-plans" type="button"><b>${user.credits}</b> ${t('nav.credits')}</button>`;
  }
  const left = user.freeLeft ?? 0;
  return `<button class="credits-pill${left ? '' : ' low'} js-plans" type="button">${t('plan.pillFree', { n: `<b>${left}</b>` })}</button>`;
}

/** Top navigation for the authenticated app view. */
export function appNavMarkup(user: ApiUser): string {
  const pill = pillMarkup(user);
  return `
  <nav class="nav">
    <a class="brand js-home" href="#/">${LOGO()}</a>
    <div class="nav-right">
      ${langSwitchMarkup()}
      ${pill}
      <span class="user-chip"><span class="avatar">${initials(user.name)}</span><span class="uname">${escapeHtml(user.name)}</span></span>
      <button class="btn btn-ghost js-logout">${t('nav.logout')}</button>
    </div>
  </nav>`;
}

/** Top navigation for the admin dashboard. */
export function adminNavMarkup(): string {
  return `
  <nav class="nav">
    <a class="brand js-home" href="#/">${LOGO()}</a>
    <div class="nav-right">
      ${langSwitchMarkup()}
      <span class="badge">${t('nav.admin')}</span>
      <button class="btn btn-ghost js-admin-logout">${t('nav.exitAdmin')}</button>
    </div>
  </nav>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
