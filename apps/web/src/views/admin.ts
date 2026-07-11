import * as api from '../api';
import { adminNavMarkup, escapeHtml } from '../ui/nav';

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
    <span class="auth-back js-home">← Back to home</span>
    <div class="auth-card">
      <div class="brand"><span class="logo">◧</span><div>NestFlow&nbsp;AI</div></div>
      <h1>Admin sign in</h1>
      <p class="sub">Restricted area.</p>
      <div class="auth-error hidden js-error"></div>
      <form class="js-form">
        <div class="form-row"><label class="field-label">Username</label><input class="input js-user" type="text" autocomplete="username" placeholder="admin" /></div>
        <div class="form-row"><label class="field-label">Password</label><input class="input js-pass" type="password" autocomplete="current-password" placeholder="••••••••" /></div>
        <button class="btn btn-primary js-submit" type="submit" style="width:100%;margin-top:6px">Enter dashboard</button>
      </form>
    </div>
  </div>`;
  root.querySelector('.js-home')?.addEventListener('click', () => navigate('#/'));
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
  root.innerHTML = `${adminNavMarkup()}<div class="container page"><div class="empty">Loading dashboard…</div></div>`;
  let data: api.AdminOverview;
  try {
    data = await api.adminOverview();
  } catch (err) {
    if (err instanceof api.ApiError && err.status === 401) {
      renderLogin(root, navigate);
      return;
    }
    root.querySelector('.empty')!.textContent = 'Could not load the dashboard. Is the API running?';
    wireNav(root, navigate);
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
      <td><button class="btn btn-ghost js-grant" data-id="${u.id}" title="Grant 50 credits">+50</button></td>
    </tr>`,
        )
        .join('')
    : `<tr><td colspan="7"><div class="empty">No users yet. Sign up from the app to see them here.</div></td></tr>`;

  const activityRows = data.usage.length
    ? data.usage
        .map(
          (e) => `<tr>
        <td style="color:var(--muted)">${fmtDate(e.at)}</td>
        <td>${escapeHtml(e.email)}</td>
        <td>${e.parts} parts</td>
        <td style="text-transform:capitalize">${escapeHtml(e.strategy)}</td>
        <td>${e.sheets} sheet${e.sheets === 1 ? '' : 's'}</td>
        <td>${e.utilPct.toFixed(1)}%</td>
        <td><b style="color:var(--warn)">−${e.cost}</b></td>
      </tr>`,
        )
        .join('')
    : `<tr><td colspan="7"><div class="empty">No nests run yet.</div></td></tr>`;

  root.innerHTML = `
  ${adminNavMarkup()}
  <div class="container page">
    <div class="page-head"><h1>Admin dashboard</h1><p>Users, credit usage and activity across NestFlow.</p></div>

    <div class="stat-grid">
      <div class="stat"><div class="k">Users</div><div class="v">${data.stats.users}</div></div>
      <div class="stat"><div class="k">Active today</div><div class="v accent">${data.stats.activeToday}</div></div>
      <div class="stat"><div class="k">Nests run</div><div class="v">${data.stats.nests}</div></div>
      <div class="stat"><div class="k">Credits used</div><div class="v accent">${data.stats.creditsUsed}</div></div>
    </div>

    <h2 style="font-size:16px;margin:6px 0 12px">Users &amp; credits</h2>
    <div class="table-wrap"><div class="table-scroll"><table class="data">
      <thead><tr><th>Name</th><th>Email</th><th>Credits</th><th>Nests</th><th>Joined</th><th>Last active</th><th></th></tr></thead>
      <tbody>${usersRows}</tbody>
    </table></div></div>

    <h2 style="font-size:16px;margin:26px 0 12px">Recent activity</h2>
    <div class="table-wrap"><div class="table-scroll"><table class="data">
      <thead><tr><th>When</th><th>User</th><th>Job</th><th>Strategy</th><th>Sheets</th><th>Utilization</th><th>Credits</th></tr></thead>
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
}

export function renderAdmin(root: HTMLElement, navigate: Nav): void {
  if (api.isAdmin()) void renderDashboard(root, navigate);
  else renderLogin(root, navigate);
}
