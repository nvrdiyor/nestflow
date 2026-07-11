import * as api from '../api';
import { adminNavMarkup, escapeHtml } from '../ui/nav';
import { langSwitchMarkup, t, wireLangSwitch } from '../i18n';

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
        <div class="form-row"><label class="field-label">${t('auth.username')}</label><input class="input js-user" type="text" autocomplete="username" placeholder="admin" /></div>
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
      renderAdmin(root, navigate);
    } catch (err) {
      errorEl.textContent = err instanceof api.ApiError ? err.message : 'Cannot reach the server.';
      errorEl.classList.remove('hidden');
    }
  });
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

  const usersRows = data.users.length
    ? data.users
        .map(
          (u) => `<tr>
      <td>${escapeHtml(u.name)}</td>
      <td style="color:var(--muted)">${escapeHtml(u.email)}</td>
      <td><b style="color:var(--accent)" data-credits="${u.id}">${u.credits}</b></td>
      <td>${u.nests}</td>
      <td style="color:var(--muted)">${fmtDate(u.createdAt)}</td>
      <td style="color:var(--muted)">${fmtDate(u.lastActive)}</td>
      <td><button class="btn btn-ghost js-grant" data-id="${u.id}" title="+50">+50</button></td>
    </tr>`,
        )
        .join('')
    : `<tr><td colspan="7"><div class="empty">${t('admin.noUsers')}</div></td></tr>`;

  const activityRows = data.usage.length
    ? data.usage
        .map(
          (e) => `<tr>
        <td style="color:var(--muted)">${fmtDate(e.at)}</td>
        <td>${escapeHtml(e.email)}</td>
        <td>${t('admin.parts', { n: e.parts })}</td>
        <td style="text-transform:capitalize">${escapeHtml(e.strategy)}</td>
        <td>${t('admin.sheetsN', { n: e.sheets })}</td>
        <td>${e.utilPct.toFixed(1)}%</td>
        <td><b style="color:var(--warn)">−${e.cost}</b></td>
      </tr>`,
        )
        .join('')
    : `<tr><td colspan="7"><div class="empty">${t('admin.noNests')}</div></td></tr>`;

  root.innerHTML = `
  ${adminNavMarkup()}
  <div class="container page">
    <div class="page-head"><h1>${t('admin.title')}</h1><p>${t('admin.sub')}</p></div>

    <div class="stat-grid">
      <div class="stat"><div class="k">${t('admin.stUsers')}</div><div class="v">${data.stats.users}</div></div>
      <div class="stat"><div class="k">${t('admin.stActive')}</div><div class="v accent">${data.stats.activeToday}</div></div>
      <div class="stat"><div class="k">${t('admin.stNests')}</div><div class="v">${data.stats.nests}</div></div>
      <div class="stat"><div class="k">${t('admin.stCredits')}</div><div class="v accent">${data.stats.creditsUsed}</div></div>
    </div>

    <h2 style="font-size:16px;margin:6px 0 12px">${t('admin.usersTitle')}</h2>
    <div class="table-wrap"><div class="table-scroll"><table class="data">
      <thead><tr><th>${t('admin.thName')}</th><th>${t('admin.thEmail')}</th><th>${t('admin.thCredits')}</th><th>${t('admin.thNests')}</th><th>${t('admin.thJoined')}</th><th>${t('admin.thLast')}</th><th></th></tr></thead>
      <tbody>${usersRows}</tbody>
    </table></div></div>

    <h2 style="font-size:16px;margin:26px 0 12px">${t('admin.activityTitle')}</h2>
    <div class="table-wrap"><div class="table-scroll"><table class="data">
      <thead><tr><th>${t('admin.thWhen')}</th><th>${t('admin.thUser')}</th><th>${t('admin.thJob')}</th><th>${t('admin.thStrategy')}</th><th>${t('admin.thSheets')}</th><th>${t('admin.thUtil')}</th><th>${t('admin.thCredits')}</th></tr></thead>
      <tbody>${activityRows}</tbody>
    </table></div></div>
  </div>`;

  wireNav(root, navigate);
  root.querySelectorAll<HTMLButtonElement>('.js-grant').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const credits = await api.adminAdjustCredits(btn.dataset.id!, 50);
        const cell = root.querySelector(`[data-credits="${btn.dataset.id}"]`);
        if (cell) cell.textContent = String(credits);
      } catch {
        btn.textContent = 'err';
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function wireNav(root: HTMLElement, navigate: Nav): void {
  root.querySelector('.js-home')?.addEventListener('click', () => navigate('#/'));
  root.querySelector('.js-admin-logout')?.addEventListener('click', () => {
    api.adminLogout();
    navigate('#/');
  });
  wireLangSwitch(root);
}

export function renderAdmin(root: HTMLElement, navigate: Nav): void {
  if (api.isAdmin()) void renderDashboard(root, navigate);
  else renderLogin(root, navigate);
}
