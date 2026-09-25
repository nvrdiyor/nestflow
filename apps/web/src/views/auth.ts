import { ApiError, getConfig, login, register, telegramStart, telegramVerify, type TgChallenge } from '../api';
import { langSwitchMarkup, t, wireLangSwitch } from '../i18n';
import { escapeHtml } from '../ui/nav';

type Nav = (hash: string) => void;
type Mode = 'login' | 'register';

const TG_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M9.78 15.27 9.6 19.3c.39 0 .56-.17.76-.37l1.83-1.75 3.79 2.78c.7.38 1.19.18 1.38-.64l2.5-11.72c.23-1.03-.37-1.44-1.05-1.19L3.2 11.9c-1 .39-.99.95-.17 1.2l3.76 1.17 8.72-5.5c.41-.27.79-.12.48.15l-7.06 6.36Z"/></svg>`;

/** Card shell shared by every auth screen. */
function shell(root: HTMLElement, navigate: Nav, inner: string): void {
  root.innerHTML = `
  <div class="auth-wrap">
    <span class="auth-back js-home">${t('nav.back')}</span>
    <div style="position:absolute;top:18px;right:20px">${langSwitchMarkup()}</div>
    <div class="auth-card">
      <div class="brand"><span class="logo">◧</span><div>Tasvir&nbsp;AI</div></div>
      ${inner}
    </div>
  </div>`;
  root.querySelector('.js-home')?.addEventListener('click', () => navigate('#/'));
  wireLangSwitch(root);
}

function errorHelpers(root: HTMLElement) {
  const errorEl = (): HTMLElement => root.querySelector<HTMLElement>('.js-error')!;
  const showError = (err: unknown): void => {
    let msg = t('auth.netError');
    if (err instanceof ApiError) {
      const code = typeof err.body.code === 'string' ? `err.${err.body.code}` : '';
      const translated = code ? t(code) : '';
      msg = translated && translated !== code ? translated : err.message;
    }
    const el = errorEl();
    el.textContent = msg;
    el.classList.remove('hidden');
  };
  return { errorEl, showError };
}

/** Step 2 of any Telegram confirmation: open the bot, press START, type the code. */
function showCodeStep(root: HTMLElement, navigate: Nav, ch: TgChallenge, note: string, back: () => void): void {
  root.querySelector('.js-title')!.textContent = t('auth.tgStepTitle');
  root.querySelector('.js-sub')!.textContent = note;
  const body = root.querySelector<HTMLElement>('.js-body')!;
  body.innerHTML = `
    <div class="auth-error hidden js-error"></div>
    <ol class="tg-steps">
      <li>${t('auth.tgStep1', { bot: escapeHtml(ch.bot) })}</li>
      <li>${t('auth.tgStep2')}</li>
    </ol>
    <a class="btn btn-tg" href="${escapeHtml(ch.link)}" target="_blank" rel="noopener">${TG_ICON}<span>${t('auth.tgOpenBot', { bot: escapeHtml(ch.bot) })}</span></a>
    <form class="js-code-form" style="margin-top:18px">
      <label class="field-label">${t('auth.tgCode')}</label>
      <input class="input tg-code js-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" />
      <button class="btn btn-primary js-verify" type="submit" style="width:100%;margin-top:12px">${t('auth.tgVerify')}</button>
    </form>
    <p class="auth-alt"><a class="js-back">${t('auth.tgBack')}</a></p>`;
  const { errorEl, showError } = errorHelpers(root);
  const codeInput = body.querySelector<HTMLInputElement>('.js-code')!;
  const verifyBtn = body.querySelector<HTMLButtonElement>('.js-verify')!;
  let sending = false;
  const submit = async (): Promise<void> => {
    const code = codeInput.value.replace(/\D/g, '');
    if (code.length !== 6 || sending) return;
    sending = true;
    verifyBtn.disabled = true;
    verifyBtn.textContent = t('auth.wait');
    errorEl().classList.add('hidden');
    try {
      await telegramVerify(ch.nonce, code);
      navigate('#/app');
    } catch (err) {
      showError(err);
      codeInput.select();
    } finally {
      sending = false;
      verifyBtn.disabled = false;
      verifyBtn.textContent = t('auth.tgVerify');
    }
  };
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
    if (codeInput.value.length === 6) void submit();
  });
  body.querySelector('.js-code-form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    void submit();
  });
  body.querySelector('.js-back')!.addEventListener('click', back);
  codeInput.focus();
}

/**
 * Sign-in / sign-up: Telegram only. The name comes from Telegram and the
 * account is created on first sign-in — no email, no password. (Without a
 * configured bot — a local dev API — the plain email form is shown instead.)
 */
export function renderAuth(root: HTMLElement, navigate: Nav, mode: Mode): void {
  shell(
    root,
    navigate,
    `
      <h1 class="js-title">${t('auth.tgOnlyTitle')}</h1>
      <p class="sub js-sub">${t('auth.tgOnlySub')}</p>
      <div class="js-body">
        <div class="auth-error hidden js-error"></div>
        <button class="btn btn-tg btn-tg-lg js-tg-login" type="button" disabled>${TG_ICON}<span>${t('auth.tgLogin')}</span></button>
        <p class="auth-alt js-free-note"></p>
      </div>`,
  );
  const { errorEl, showError } = errorHelpers(root);
  const btn = root.querySelector<HTMLButtonElement>('.js-tg-login')!;

  void getConfig().then((cfg) => {
    if (!btn.isConnected) return;
    if (!cfg.telegramBot) {
      renderEmailForm(root, navigate, mode);
      return;
    }
    btn.disabled = false;
    const note = root.querySelector<HTMLElement>('.js-free-note');
    if (note && cfg.trialDays > 0) note.textContent = t('auth.tgTrialNote', { n: cfg.trialDays });
    else if (note && cfg.freeNests > 0) note.textContent = t('auth.tgFreeNote', { n: cfg.freeNests });
  });

  btn.addEventListener('click', async () => {
    errorEl().classList.add('hidden');
    btn.disabled = true;
    try {
      showCodeStep(root, navigate, await telegramStart(), t('auth.tgLoginNote'), () =>
        renderAuth(root, navigate, mode),
      );
    } catch (err) {
      showError(err);
      btn.disabled = false;
    }
  });
}

/** Email + password form — only for API instances without a Telegram bot (local dev). */
function renderEmailForm(root: HTMLElement, navigate: Nav, mode: Mode): void {
  const isReg = mode === 'register';
  shell(
    root,
    navigate,
    `
      <h1 class="js-title">${isReg ? t('auth.createTitle') : t('auth.welcomeTitle')}</h1>
      <p class="sub js-sub">${t('auth.loginSub')}</p>
      <div class="js-body">
        <div class="auth-tabs">
          <button class="js-tab-login ${isReg ? '' : 'active'}">${t('auth.tabLogin')}</button>
          <button class="js-tab-register ${isReg ? 'active' : ''}">${t('auth.tabSignup')}</button>
        </div>
        <div class="auth-error hidden js-error"></div>
        <form class="js-form">
          ${
            isReg
              ? `<div class="form-row"><label class="field-label">${t('auth.name')}</label><input class="input js-name" type="text" autocomplete="name" /></div>`
              : ''
          }
          <div class="form-row"><label class="field-label">${t('auth.email')}</label><input class="input js-email" type="email" autocomplete="email" placeholder="you@example.com" /></div>
          <div class="form-row"><label class="field-label">${t('auth.password')}</label><input class="input js-pass" type="password" autocomplete="${isReg ? 'new-password' : 'current-password'}" placeholder="••••••••" /></div>
          <button class="btn btn-primary js-submit" type="submit" style="width:100%;margin-top:6px">${isReg ? t('auth.createBtn') : t('auth.loginBtn')}</button>
        </form>
        <p class="auth-alt">${isReg ? t('auth.haveAccount') : t('auth.noAccount')}</p>
      </div>`,
  );
  root.querySelectorAll('.js-tab-login').forEach((b) => b.addEventListener('click', () => navigate('#/login')));
  root.querySelectorAll('.js-tab-register').forEach((b) => b.addEventListener('click', () => navigate('#/register')));
  const { errorEl, showError } = errorHelpers(root);
  const submitBtn = root.querySelector<HTMLButtonElement>('.js-submit')!;
  root.querySelector<HTMLFormElement>('.js-form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl().classList.add('hidden');
    const email = root.querySelector<HTMLInputElement>('.js-email')!.value;
    const pass = root.querySelector<HTMLInputElement>('.js-pass')!.value;
    submitBtn.disabled = true;
    submitBtn.textContent = t('auth.wait');
    try {
      if (isReg) {
        const res = await register(root.querySelector<HTMLInputElement>('.js-name')!.value, email, pass);
        if ('pending' in res) {
          showCodeStep(root, navigate, res.pending, t('auth.tgRegNote'), () => renderEmailForm(root, navigate, mode));
          return;
        }
      } else {
        await login(email, pass);
      }
      navigate('#/app');
    } catch (err) {
      showError(err);
    } finally {
      if (submitBtn.isConnected) {
        submitBtn.disabled = false;
        submitBtn.textContent = isReg ? t('auth.createBtn') : t('auth.loginBtn');
      }
    }
  });
}
