import { ApiError, login, register } from '../api';
import { langSwitchMarkup, t, wireLangSwitch } from '../i18n';

type Nav = (hash: string) => void;
type Mode = 'login' | 'register';

export function renderAuth(root: HTMLElement, navigate: Nav, mode: Mode): void {
  const isReg = mode === 'register';
  root.innerHTML = `
  <div class="auth-wrap">
    <span class="auth-back js-home">${t('nav.back')}</span>
    <div style="position:absolute;top:18px;right:20px">${langSwitchMarkup()}</div>
    <div class="auth-card">
      <div class="brand"><span class="logo">◧</span><div>NestFlow&nbsp;AI</div></div>
      <h1>${isReg ? t('auth.createTitle') : t('auth.welcomeTitle')}</h1>
      <p class="sub">${isReg ? t('auth.createSub') : t('auth.loginSub')}</p>

      <div class="auth-tabs">
        <button class="js-tab-login ${isReg ? '' : 'active'}">${t('auth.tabLogin')}</button>
        <button class="js-tab-register ${isReg ? 'active' : ''}">${t('auth.tabSignup')}</button>
      </div>

      <div class="auth-error hidden js-error"></div>

      <form class="js-form">
        ${
          isReg
            ? `<div class="form-row"><label class="field-label">${t('auth.name')}</label><input class="input js-name" type="text" autocomplete="name" placeholder="Iyorbek" /></div>`
            : ''
        }
        <div class="form-row"><label class="field-label">${t('auth.email')}</label><input class="input js-email" type="email" autocomplete="email" placeholder="you@example.com" /></div>
        <div class="form-row"><label class="field-label">${t('auth.password')}</label><input class="input js-pass" type="password" autocomplete="${isReg ? 'new-password' : 'current-password'}" placeholder="••••••••" /></div>
        <button class="btn btn-primary js-submit" type="submit" style="width:100%;margin-top:6px">${isReg ? t('auth.createBtn') : t('auth.loginBtn')}</button>
      </form>

      <p class="auth-alt">${isReg ? t('auth.haveAccount') : t('auth.noAccount')}</p>
      <p class="auth-alt" style="margin-top:8px"><a class="js-admin">${t('auth.adminSignin')}</a></p>
    </div>
  </div>`;

  const errorEl = root.querySelector<HTMLElement>('.js-error')!;
  const showError = (msg: string): void => {
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
  };

  root.querySelector('.js-home')?.addEventListener('click', () => navigate('#/'));
  root.querySelectorAll('.js-tab-login').forEach((b) => b.addEventListener('click', () => navigate('#/login')));
  root.querySelectorAll('.js-tab-register').forEach((b) => b.addEventListener('click', () => navigate('#/register')));
  root.querySelector('.js-admin')?.addEventListener('click', () => navigate('#/admin'));
  wireLangSwitch(root);

  const submitBtn = root.querySelector<HTMLButtonElement>('.js-submit')!;
  root.querySelector<HTMLFormElement>('.js-form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.classList.add('hidden');
    const email = root.querySelector<HTMLInputElement>('.js-email')!.value;
    const pass = root.querySelector<HTMLInputElement>('.js-pass')!.value;
    submitBtn.disabled = true;
    submitBtn.textContent = t('auth.wait');
    try {
      if (isReg) await register(root.querySelector<HTMLInputElement>('.js-name')!.value, email, pass);
      else await login(email, pass);
      navigate('#/app');
    } catch (err) {
      showError(err instanceof ApiError ? err.message : t('auth.netError'));
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = isReg ? t('auth.createBtn') : t('auth.loginBtn');
    }
  });
}
