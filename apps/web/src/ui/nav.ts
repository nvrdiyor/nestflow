import type { ApiUser } from '../api';
import { langSwitchMarkup, t } from '../i18n';

const LOGO = (): string => `<span class="logo">◧</span><div>NestFlow&nbsp;AI<small>${t('brand.tag')}</small></div>`;

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? '';
  const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (a + b).toUpperCase() || '?';
}

/** Top navigation for the authenticated app view. */
export function appNavMarkup(user: ApiUser): string {
  const low = user.credits <= 10 ? ' low' : '';
  return `
  <nav class="nav">
    <a class="brand js-home" href="#/">${LOGO()}</a>
    <div class="nav-right">
      ${langSwitchMarkup()}
      <span class="credits-pill${low}"><b class="js-credits">${user.credits}</b> ${t('nav.credits')}</span>
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
