import { isLoggedIn } from '../api';
import { STARTING_CREDITS } from '../cost';
import { langSwitchMarkup, t, wireLangSwitch } from '../i18n';

type Nav = (hash: string) => void;

const HERO_SVG = `
<svg viewBox="0 0 900 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Parts nested on a cutting sheet">
  <rect x="0" y="0" width="900" height="300" fill="#0e1220"/>
  <rect x="24" y="24" width="852" height="252" fill="#11151f" stroke="#2c344a" stroke-width="2"/>
  <path d="M60 70 a60 60 0 1 0 0.1 0 Z M120 130 a30 30 0 1 1 -0.1 0 Z" fill="#2563eb" fill-opacity="0.85" fill-rule="evenodd"/>
  <path d="M180 40 L260 40 L220 130 Z" fill="#8b5cf6" fill-opacity="0.85"/>
  <path d="M182 260 L262 260 L222 172 Z" fill="#16a34a" fill-opacity="0.85"/>
  <path d="M280 50 a55 55 0 1 0 0.1 0 Z M330 105 a27 27 0 1 1 -0.1 0 Z" fill="#0d9488" fill-opacity="0.85" fill-rule="evenodd"/>
  <rect x="360" y="40" width="150" height="40" rx="4" fill="#db2777" fill-opacity="0.85"/>
  <rect x="360" y="96" width="150" height="40" rx="4" fill="#f59e0b" fill-opacity="0.85"/>
  <path d="M360 160 L500 160 L500 200 L400 200 L400 260 L360 260 Z" fill="#dc2626" fill-opacity="0.85"/>
  <path d="M540 44 L620 44 L580 132 Z" fill="#0891b2" fill-opacity="0.85"/>
  <path d="M540 256 L620 256 L580 168 Z" fill="#c026d3" fill-opacity="0.85"/>
  <path d="M650 50 a56 56 0 1 0 0.1 0 Z M700 106 a26 26 0 1 1 -0.1 0 Z" fill="#65a30d" fill-opacity="0.85" fill-rule="evenodd"/>
  <rect x="770" y="44" width="86" height="86" rx="4" fill="#2563eb" fill-opacity="0.85"/>
  <rect x="770" y="150" width="86" height="86" rx="4" fill="#8b5cf6" fill-opacity="0.85"/>
  <line x1="540" y1="138" x2="620" y2="138" stroke="#f97316" stroke-width="4" stroke-linecap="round"/>
  <line x1="770" y1="140" x2="856" y2="140" stroke="#f97316" stroke-width="4" stroke-linecap="round"/>
</svg>`;

export function renderLanding(root: HTMLElement, navigate: Nav): void {
  const loggedIn = isLoggedIn();
  const primaryCta = loggedIn
    ? `<button class="btn btn-primary btn-lg js-app">${t('landing.openAppArrow')}</button>`
    : `<button class="btn btn-primary btn-lg js-start">${t('landing.getStarted')}</button>`;
  const feat = (i: number, ic: string, delay: number) =>
    `<div class="feature" data-aos="fade-up" data-aos-delay="${delay}"><div class="ic"><i data-lucide="${ic}"></i></div><h3>${t(`landing.f${i}t`)}</h3><p>${t(`landing.f${i}d`)}</p></div>`;
  const step = (i: number, delay: number) =>
    `<div class="step" data-aos="fade-up" data-aos-delay="${delay}"><div class="num">${i}</div><h4>${t(`landing.s${i}t`)}</h4><p>${t(`landing.s${i}d`)}</p></div>`;

  root.innerHTML = `
  <header class="container landing-nav">
    <a class="brand js-home" href="#/"><span class="logo">◧</span><div>NestFlow&nbsp;AI<small>${t('brand.tag')}</small></div></a>
    <div style="display:flex;gap:10px;align-items:center">
      ${langSwitchMarkup()}
      ${loggedIn ? `<button class="btn btn-ghost js-app">${t('landing.openApp')}</button>` : `<button class="btn btn-ghost js-login">${t('landing.login')}</button><button class="btn btn-primary js-start">${t('landing.signup')}</button>`}
    </div>
  </header>

  <section class="hero">
    <div class="container">
      <span class="eyebrow">${t('landing.eyebrowTop')}</span>
      <h1>${t('landing.heroTitle')}</h1>
      <p class="lead">${t('landing.heroLead')}</p>
      <div class="hero-cta">${primaryCta}<a class="btn btn-lg js-how" href="#how">${t('landing.howItWorks')}</a></div>
      <div class="hero-figure">${HERO_SVG}</div>
    </div>
  </section>

  <section class="section" id="features">
    <div class="container">
      <div class="section-head" data-aos="fade-up">
        <span class="eyebrow">${t('landing.featuresEyebrow')}</span>
        <h2>${t('landing.featuresTitle')}</h2>
        <p>${t('landing.featuresSub')}</p>
      </div>
      <div class="grid-3">
        ${feat(1, 'type', 0)}${feat(2, 'upload', 60)}${feat(3, 'puzzle', 120)}${feat(4, 'scissors', 0)}${feat(5, 'layout-grid', 60)}${feat(6, 'download', 120)}
      </div>
    </div>
  </section>

  <section class="section" id="how" style="background:var(--bg-2);border-block:1px solid var(--line)">
    <div class="container">
      <div class="section-head" data-aos="fade-up"><span class="eyebrow">${t('landing.howEyebrow')}</span><h2>${t('landing.howTitle')}</h2></div>
      <div class="steps">${step(1, 0)}${step(2, 70)}${step(3, 140)}${step(4, 210)}</div>
    </div>
  </section>

  <section class="section" id="credits">
    <div class="container">
      <div class="section-head" data-aos="fade-up"><span class="eyebrow">${t('landing.creditsEyebrow')}</span><h2>${t('landing.creditsTitle')}</h2><p>${t('landing.creditsSub', { n: STARTING_CREDITS })}</p></div>
      <div class="credits-box" data-aos="fade-up" data-aos-delay="60">
        <div class="credits-formula">cost = strategyBase + ⌈ parts ÷ 15 ⌉&nbsp;&nbsp;&nbsp;(Fast = 1, Balanced = 3, Max = 6)</div>
        <div class="credit-examples">
          <div class="credit-ex"><div class="n">2<small> cr</small></div><div class="d">${t('landing.creditsEx1')}</div></div>
          <div class="credit-ex"><div class="n">7<small> cr</small></div><div class="d">${t('landing.creditsEx2')}</div></div>
          <div class="credit-ex"><div class="n">13<small> cr</small></div><div class="d">${t('landing.creditsEx3')}</div></div>
        </div>
      </div>
      <div style="text-align:center;margin-top:32px">${primaryCta}</div>
    </div>
  </section>

  <footer class="footer">
    <div class="container">
      <span>${t('landing.footer')}</span>
      <span>${t('landing.footerNote')}</span>
    </div>
  </footer>`;

  const go = (h: string) => (e: Event) => {
    e.preventDefault();
    navigate(h);
  };
  root.querySelectorAll<HTMLElement>('.js-start').forEach((b) => b.addEventListener('click', go('#/register')));
  root.querySelectorAll<HTMLElement>('.js-login').forEach((b) => b.addEventListener('click', go('#/login')));
  root.querySelectorAll<HTMLElement>('.js-app').forEach((b) => b.addEventListener('click', go('#/app')));
  root.querySelectorAll<HTMLElement>('.js-home').forEach((b) => b.addEventListener('click', go('#/')));
  root.querySelector<HTMLElement>('.js-how')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' });
  });
  wireLangSwitch(root);
}
