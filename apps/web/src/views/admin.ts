import * as api from '../api';
import { adminNavMarkup, escapeHtml } from '../ui/nav';
import { langSwitchMarkup, t, wireLangSwitch } from '../i18n';
import { fmtDay, fmtSum } from '../ui/plans';

type Nav = (hash: string) => void;

function fmtDate(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

function renderLogin(root: HTMLElement, navigate: Nav): void {
  root.innerHTML = `
  <div class="auth-wrap">
    <span class="auth-back js-home">${t('nav.back')}</span>
    <div style="position:absolute;top:18px;right:20px">${langSwitchMarkup()}</div>
    <div class="auth-card">
      <div class="brand"><span class="logo">◧</span><div>NestFlow&nbsp;AI</div></div>
      <h1>${t('auth.adminTitle')}</h1>
      <p class="sub">${t('auth.adminSub')}</p>
      <div class="auth-error hidden js-error"></div>
      <form class="js-form">
        <div class="form-row"><label class="field-label">${t('auth.username')}</label><input class="input js-user" type="text" autocomplete="username" /></div>
        <div class="form-row"><label class="field-label">${t('auth.password')}</label><input class="input js-pass" type="password" autocomplete="current-password" placeholder="••••••••" /></div>
        <button class="btn btn-primary js-submit" type="submit" style="width:100%;margin-top:6px">${t('auth.enterDashboard')}</button>
      </form>
    </div>
  </div>`;
  root.querySelector('.js-home')?.addEventListener('click', () => navigate('#/'));
  wireLangSwitch(root);
  const errorEl = root.querySelector<HTMLElement>('.js-error')!;
  root.querySelector<HTMLFormElement>('.js-form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.classList.add('hidden');
    const u = root.querySelector<HTMLInputElement>('.js-user')!.value;
    const p = root.querySelector<HTMLInputElement>('.js-pass')!.value;
    try {
      await api.adminLogin(u, p);
      void renderDashboard(root, navigate);
    } catch (err) {
      errorEl.textContent = err instanceof api.ApiError && err.status === 401 ? t('admin.invalidAdmin') : t('auth.netError');
      errorEl.classList.remove('hidden');
    }
  });
}

const planBadge = (u: api.ApiUser): string => {
  const plan = u.plan ?? 'free';
  if (plan === 'free') {
    return `<span class="plan-badge free">${t('plan.free')}</span><div class="admin-sub">${t('admin.freeLeft', { n: u.freeLeft ?? 0 })}</div>`;
  }
  return `<span class="plan-badge ${plan}">${plan.toUpperCase()}</span><div class="admin-sub">${t('plan.until', { date: fmtDay(u.planUntil ?? 0) })}</div>`;
};

const userCell = (u: api.ApiUser): string =>
  `${escapeHtml(u.name)}${
    u.telegram != null ? `<div class="admin-tg">✈ ${u.telegram ? '@' + escapeHtml(u.telegram) : 'Telegram'}</div>` : ''
  }${u.email ? `<div class="admin-sub">${escapeHtml(u.email)}</div>` : ''}`;

function userRow(u: api.ApiUser): string {
  const months = [1, 2, 3, 6, 12].map((m) => `<option value="${m}">${t('admin.months', { n: m })}</option>`).join('');
  return `<tr data-id="${u.id}">
    <td>${userCell(u)}</td>
    <td>${planBadge(u)}</td>
    <td><b class="admin-credits">${u.credits}</b></td>
    <td>${u.nests}</td>
    <td class="admin-sub">${fmtDate(u.createdAt)}<br />${fmtDate(u.lastActive)}</td>
    <td><div class="admin-actions">
      <select class="input js-months" aria-label="${t('admin.thPlan')}">${months}</select>
      <button class="btn btn-ghost js-give" data-plan="pro">${t('admin.giveP')}</button>
      <button class="btn btn-ghost js-give vip" data-plan="vip">${t('admin.giveV')}</button>
      ${(u.plan ?? 'free') !== 'free' ? `<button class="btn btn-ghost js-revoke">${t('admin.revoke')}</button>` : ''}
      <button class="btn btn-ghost js-adjust">${t('admin.credits')}</button>
    </div></td>
  </tr>`;
}

async function renderDashboard(root: HTMLElement, navigate: Nav): Promise<void> {
  root.innerHTML = `${adminNavMarkup()}<div class="container page"><div class="empty">${t('admin.loading')}</div></div>`;
  wireNav(root, navigate);
  let data: api.AdminOverview;
  try {
    data = await api.adminOverview();
  } catch (err) {
    if (err instanceof api.ApiError && err.status === 401) {
      renderLogin(root, navigate);
      return;
    }
    root.querySelector('.empty')!.textContent = t('admin.loadFail');
    return;
  }
  const users = data.users;
  const s = data.settings;
  const count = (plan: string): number => users.filter((u) => (u.plan ?? 'free') === plan).length;

  const activityRows = data.usage.length
    ? data.usage
        .map(
          (e) => `<tr>
        <td class="admin-sub">${fmtDate(e.at)}</td>
        <td>${escapeHtml(e.name || e.email)}${e.telegram ? `<div class="admin-tg">@${escapeHtml(e.telegram)}</div>` : ''}</td>
        <td>${t('admin.parts', { n: e.parts })}</td>
        <td>${t('admin.sheetsN', { n: e.sheets })}</td>
        <td>${e.utilPct.toFixed(1)}%</td>
        <td><b style="color:var(--warn)">${e.cost ? '−' + e.cost : '0'}</b></td>
      </tr>`,
        )
        .join('')
    : `<tr><td colspan="6"><div class="empty">${t('admin.noNests')}</div></td></tr>`;

  const field = (key: keyof api.PlanSettings, label: string, value: string | number, type = 'number'): string =>
    `<label class="field"><span>${label}</span><input class="input js-set" data-key="${key}" type="${type}" value="${escapeHtml(String(value))}" ${type === 'number' ? 'min="0" step="1"' : ''} /></label>`;

  root.innerHTML = `
  ${adminNavMarkup()}
  <div class="container page">
    <div class="page-head"><h1>${t('admin.title')}</h1><p>${t('admin.sub')}</p></div>

    <div class="stat-grid">
      <div class="stat"><div class="k">${t('admin.stUsers')}</div><div class="v">${data.stats.users}</div></div>
      <div class="stat"><div class="k">${t('admin.stActive')}</div><div class="v accent">${data.stats.activeToday}</div></div>
      <div class="stat"><div class="k">${t('admin.stNests')}</div><div class="v">${data.stats.nests}</div></div>
      <div class="stat"><div class="k">PRO / VIP</div><div class="v accent">${count('pro')} / ${count('vip')}</div></div>
    </div>

    <h2 class="admin-h2">${t('admin.plansTitle')}</h2>
    <form class="admin-settings js-settings">
      ${field('proPrice', t('admin.proPrice'), s.proPrice)}
      ${field('proMonthlyCredits', t('admin.proCredits'), s.proMonthlyCredits)}
      ${field('vipPrice', t('admin.vipPrice'), s.vipPrice)}
      ${field('freeNests', t('admin.freeNests'), s.freeNests)}
      ${field('salesContact', t('admin.salesContact'), '@' + s.salesContact, 'text')}
      <div class="admin-settings-foot">
        <span class="admin-sub js-settings-status">PRO ${fmtSum(s.proPrice)} · VIP ${fmtSum(s.vipPrice)} ${t('plan.perMonth')}</span>
        <button class="btn btn-primary" type="submit">${t('admin.save')}</button>
      </div>
    </form>

    <div class="admin-users-head">
      <h2 class="admin-h2">${t('admin.usersTitle')}</h2>
      <input class="input admin-search js-search" type="search" placeholder="${t('admin.search')}" />
    </div>
    <div class="table-wrap"><div class="table-scroll"><table class="data">
      <thead><tr><th>${t('admin.thName')}</th><th>${t('admin.thPlan')}</th><th>${t('admin.thCredits')}</th><th>${t('admin.thNests')}</th><th>${t('admin.thJoined')} / ${t('admin.thLast')}</th><th>${t('admin.thActions')}</th></tr></thead>
      <tbody class="js-users"></tbody>
    </table></div></div>

    <h2 class="admin-h2" style="margin-top:26px">${t('admin.activityTitle')}</h2>
    <div class="table-wrap"><div class="table-scroll"><table class="data">
      <thead><tr><th>${t('admin.thWhen')}</th><th>${t('admin.thUser')}</th><th>${t('admin.thJob')}</th><th>${t('admin.thSheets')}</th><th>${t('admin.thUtil')}</th><th>${t('admin.thCredits')}</th></tr></thead>
      <tbody>${activityRows}</tbody>
    </table></div></div>
  </div>`;
  wireNav(root, navigate);

  const tbody = root.querySelector<HTMLElement>('.js-users')!;
  const search = root.querySelector<HTMLInputElement>('.js-search')!;
  const drawUsers = (): void => {
    const q = search.value.trim().toLowerCase().replace(/^@/, '');
    const shown = q
      ? users.filter((u) => `${u.name} ${u.telegram ?? ''} ${u.email}`.toLowerCase().includes(q))
      : users;
    tbody.innerHTML = shown.length
      ? shown.map(userRow).join('')
      : `<tr><td colspan="6"><div class="empty">${t('admin.noUsers')}</div></td></tr>`;
  };
  drawUsers();
  search.addEventListener('input', drawUsers);

  const replaceUser = (u: api.ApiUser): void => {
    const i = users.findIndex((x) => x.id === u.id);
    if (i >= 0) users[i] = { ...users[i]!, ...u };
    drawUsers();
  };

  tbody.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    const row = btn?.closest<HTMLElement>('tr[data-id]');
    if (!btn || !row) return;
    const id = row.dataset.id!;
    const user = users.find((u) => u.id === id);
    if (!user) return;
    btn.disabled = true;
    try {
      if (btn.classList.contains('js-give')) {
        const months = Number(row.querySelector<HTMLSelectElement>('.js-months')!.value) || 1;
        replaceUser(await api.adminSetPlan(id, btn.dataset.plan as 'pro' | 'vip', months));
      } else if (btn.classList.contains('js-revoke')) {
        if (!window.confirm(t('admin.confirmRevoke', { name: user.name }))) return;
        replaceUser(await api.adminSetPlan(id, 'free'));
      } else if (btn.classList.contains('js-adjust')) {
        const raw = window.prompt(t('admin.creditsPrompt'), '1000');
        const delta = Math.trunc(Number(raw));
        if (!raw || !Number.isFinite(delta) || delta === 0) return;
        replaceUser({ ...user, credits: await api.adminAdjustCredits(id, delta) });
      }
    } catch (err) {
      window.alert(err instanceof api.ApiError ? err.message : t('admin.loadFail'));
    } finally {
      if (btn.isConnected) btn.disabled = false;
    }
  });

  const form = root.querySelector<HTMLFormElement>('.js-settings')!;
  const status = root.querySelector<HTMLElement>('.js-settings-status')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = (k: string): string => form.querySelector<HTMLInputElement>(`[data-key="${k}"]`)!.value.trim();
    try {
      const saved = await api.adminSaveSettings({
        proPrice: Math.round(Number(val('proPrice'))),
        vipPrice: Math.round(Number(val('vipPrice'))),
        proMonthlyCredits: Math.round(Number(val('proMonthlyCredits'))),
        freeNests: Math.round(Number(val('freeNests'))),
        salesContact: val('salesContact'),
      });
      status.textContent = `${t('admin.saved')} · PRO ${fmtSum(saved.proPrice)} · VIP ${fmtSum(saved.vipPrice)} ${t('plan.perMonth')}`;
      status.style.color = 'var(--good, #34d399)';
    } catch (err) {
      status.textContent = err instanceof api.ApiError ? err.message : t('admin.loadFail');
      status.style.color = 'var(--warn)';
    }
  });
}

function wireNav(root: HTMLElement, navigate: Nav): void {
  root.querySelector('.js-home')?.addEventListener('click', () => navigate('#/'));
  root.querySelector('.js-admin-logout')?.addEventListener('click', () => {
    api.adminLogout();
    renderLogin(root, navigate);
  });
  wireLangSwitch(root);
}

export function renderAdmin(root: HTMLElement, navigate: Nav): void {
  if (api.isAdmin()) void renderDashboard(root, navigate);
  else renderLogin(root, navigate);
}
