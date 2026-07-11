import { ApiError, login, register } from '../api';

type Nav = (hash: string) => void;
type Mode = 'login' | 'register';

export function renderAuth(root: HTMLElement, navigate: Nav, mode: Mode): void {
  const isReg = mode === 'register';
  root.innerHTML = `
  <div class="auth-wrap">
    <span class="auth-back js-home">← Back to home</span>
    <div class="auth-card">
      <div class="brand"><span class="logo">◧</span><div>NestFlow&nbsp;AI</div></div>
      <h1>${isReg ? 'Create your account' : 'Welcome back'}</h1>
      <p class="sub">${isReg ? 'Start with 100 free credits.' : 'Log in to keep cutting.'}</p>

      <div class="auth-tabs">
        <button class="js-tab-login ${isReg ? '' : 'active'}">Log in</button>
        <button class="js-tab-register ${isReg ? 'active' : ''}">Sign up</button>
      </div>

      <div class="auth-error hidden js-error"></div>

      <form class="js-form">
        ${
          isReg
            ? `<div class="form-row"><label class="field-label">Name</label><input class="input js-name" type="text" autocomplete="name" placeholder="Iyorbek" /></div>`
            : ''
        }
        <div class="form-row"><label class="field-label">Email</label><input class="input js-email" type="email" autocomplete="email" placeholder="you@example.com" /></div>
        <div class="form-row"><label class="field-label">Password</label><input class="input js-pass" type="password" autocomplete="${isReg ? 'new-password' : 'current-password'}" placeholder="••••••••" /></div>
        <button class="btn btn-primary js-submit" type="submit" style="width:100%;margin-top:6px">${isReg ? 'Create account' : 'Log in'}</button>
      </form>

      <p class="auth-alt">
        ${isReg ? 'Already have an account? <a class="js-tab-login">Log in</a>' : "New here? <a class=\"js-tab-register\">Create an account</a>"}
      </p>
      <p class="auth-alt" style="margin-top:8px"><a class="js-admin">Admin sign in</a></p>
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

  const submitBtn = root.querySelector<HTMLButtonElement>('.js-submit')!;
  root.querySelector<HTMLFormElement>('.js-form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.classList.add('hidden');
    const email = root.querySelector<HTMLInputElement>('.js-email')!.value;
    const pass = root.querySelector<HTMLInputElement>('.js-pass')!.value;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Please wait…';
    try {
      if (isReg) await register(root.querySelector<HTMLInputElement>('.js-name')!.value, email, pass);
      else await login(email, pass);
      navigate('#/app');
    } catch (err) {
      if (err instanceof ApiError) showError(err.message);
      else showError('Cannot reach the server. Is the API running?');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = isReg ? 'Create account' : 'Log in';
    }
  });
}
