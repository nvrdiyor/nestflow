import { isLoggedIn } from '../api';
import { getConfig, getStats } from '../api';
import { fmtSum, periodPickerMarkup, salesLink, wirePeriods } from '../ui/plans';
import { langSwitchMarkup, t, wireLangSwitch } from '../i18n';

type Nav = (hash: string) => void;

const GITHUB = 'https://github.com/nvrdiyor/nestflow';

/**
 * The hero visual: a macOS-style glass app window with a live-looking nesting
 * canvas. Parts are thin glowing outlines (no filled color blobs) that settle
 * into place one by one; a dashed cut path marches around them.
 */
const heroWindow = (): string => `
<div class="mw-wrap" id="mwWrap">
  <div class="mock-window" id="mockWin">
    <div class="mw-bar">
      <span class="tl r"></span><span class="tl y"></span><span class="tl g"></span>
      <span class="mw-title">Tasvir AI — Sheet 1</span>
      <span class="mw-chips"><i>Lazer 1210×900</i><i>2 mm</i><i>Max</i></span>
    </div>
    <div class="mw-body">
      <div class="mw-canvas">
        <svg viewBox="0 0 380 250" xmlns="http://www.w3.org/2000/svg" aria-label="Nesting preview">
          <defs>
            <pattern id="mwgrid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M20 0H0V20" fill="none" stroke="rgba(148,163,184,0.07)" stroke-width="1"/>
            </pattern>
          </defs>
          <rect x="10" y="10" width="360" height="230" rx="6" fill="rgba(9,13,31,0.6)" stroke="rgba(148,163,184,0.18)"/>
          <rect x="10" y="10" width="360" height="230" rx="6" fill="url(#mwgrid)"/>
          <g class="parts" fill="rgba(139,92,246,0.08)" stroke="#8B5CF6" stroke-width="1.4">
            <path class="pt" fill-rule="evenodd" d="M89 80a34 34 0 1 0-68 0a34 34 0 1 0 68 0Zm-18 0a16 16 0 1 1-32 0a16 16 0 1 1 32 0Z"/>
            <path class="pt" fill-rule="evenodd" d="M81 176a26 26 0 1 0-52 0a26 26 0 1 0 52 0Zm-14 0a12 12 0 1 1-24 0a12 12 0 1 1 24 0Z"/>
            <path class="pt" d="M100 46h70v28h-42v60h-28Z"/>
            <path class="pt" d="M185 46h80v24h-28v52h-24v-52h-28Z"/>
            <path class="pt" d="M280 46l70 0l-70 70Z"/>
            <path class="pt" d="M355 126v-70l-65 70Z"/>
            <path class="pt" fill-rule="evenodd" d="M100 150h150v70h-150Zm38 35a11 11 0 1 0 22 0a11 11 0 1 0-22 0Zm52 0a11 11 0 1 0 22 0a11 11 0 1 0-22 0Z"/>
            <rect class="pt" x="264" y="150" width="24" height="24" rx="2"/>
            <rect class="pt" x="294" y="150" width="24" height="24" rx="2"/>
            <rect class="pt" x="324" y="150" width="24" height="24" rx="2"/>
            <circle class="pt" cx="342" cy="212" r="14"/>
            <path class="pt" d="M264 186h50v40h-50Z"/>
          </g>
          <path class="cutline" d="M21 80a34 34 0 1 0 68 0a34 34 0 1 0-68 0M100 46h70v28h-42v60h-28Z"
            fill="none" stroke="#6C63FF" stroke-width="1.6" stroke-dasharray="5 7" stroke-linecap="round"/>
          <circle class="cuthead" r="3" fill="#6C63FF"/>
        </svg>
        <div class="mw-badge"><span class="dot"></span>82.7% · Sheet 1</div>
      </div>
      <div class="mw-side">
        <div class="ms-row"><span>Utilization</span><b>82.7%</b></div>
        <div class="ms-bar"><i style="width:82.7%"></i></div>
        <div class="ms-row"><span>Sheets</span><b>1 / 2</b></div>
        <div class="ms-row"><span>Cut length</span><b>10.2 m</b></div>
        <div class="ms-row good"><span>Common-line</span><b>−4.0 m</b></div>
        <div class="ms-run">⌘ Nest · 8s</div>
      </div>
    </div>
  </div>
  <div class="mw-glow"></div>
</div>`;

/** Side-by-side sheets for the Before / After comparison. */
const cmpSvg = (packed: boolean): string => {
  const stroke = packed ? '#8B5CF6' : 'rgba(148,163,184,0.5)';
  const fill = packed ? 'rgba(139,92,246,0.07)' : 'none';
  const parts = packed
    ? `<path fill-rule="evenodd" d="M60 96a22 22 0 1 0-44 0a22 22 0 1 0 44 0Zm-12 0a10 10 0 1 1-20 0a10 10 0 1 1 20 0Z"/>
       <path d="M66 74h44v18h-26v34h-18Z"/>
       <path d="M116 74h52v16h-18v36h-16v-36h-18Z"/>
       <path d="M174 74l44 0l-44 44Z"/>
       <path d="M222 122v-44l-42 44Z"/>
       <path fill-rule="evenodd" d="M66 130h92v42h-92Zm22 21a7 7 0 1 0 14 0a7 7 0 1 0-14 0Zm34 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0Z"/>
       <rect x="164" y="130" width="18" height="18" rx="2"/><rect x="186" y="130" width="18" height="18" rx="2"/>
       <rect x="164" y="152" width="40" height="20" rx="2"/>`
    : `<path fill-rule="evenodd" d="M56 54a18 18 0 1 0-36 0a18 18 0 1 0 36 0Zm-10 0a8 8 0 1 1-16 0a8 8 0 1 1 16 0Z"/>
       <path d="M96 36h36v15h-21v28h-15Z"/>
       <path d="M160 36h42v13h-15v30h-13v-30h-14Z"/>
       <path d="M20 100l36 0l-36 36Z"/>
       <path d="M96 100h74v34h-74Z"/>
       <rect x="190" y="100" width="15" height="15" rx="2"/>
       <rect x="190" y="120" width="15" height="15" rx="2"/>
       <rect x="20 " y="150" width="34" height="16" rx="2"/>`;
  return `<svg viewBox="0 0 240 190" xmlns="http://www.w3.org/2000/svg">
    <rect x="6" y="6" width="228" height="178" rx="6" fill="rgba(9,13,31,0.55)" stroke="rgba(148,163,184,0.16)"/>
    <g fill="${fill}" stroke="${stroke}" stroke-width="1.3">${parts}</g>
  </svg>`;
};

/** Landing-page listeners that outlive the view; re-entry replaces them. */
let cleanupFns: Array<() => void> = [];
const cleanupAll = (): void => {
  cleanupFns.forEach((f) => f());
  cleanupFns = [];
};

export function renderLanding(root: HTMLElement, navigate: Nav): void {
  cleanupAll();
  const loggedIn = isLoggedIn();
  const startCta = loggedIn
    ? `<button class="btn btn-primary btn-lg magnetic js-app">${t('landing.openApp')} <i data-lucide="arrow-right"></i></button>`
    : `<button class="btn btn-primary btn-lg magnetic js-start">${t('l.ctaStart')} <i data-lucide="arrow-right"></i></button>`;

  const feat = (i: number, ic: string): string =>
    `<div class="feature rv"><div class="ic"><i data-lucide="${ic}"></i></div><h3>${t(`l.f${i}t`)}</h3><p>${t(`l.f${i}d`)}</p></div>`;
  const step = (i: number): string =>
    `<div class="step rv"><div class="num">${String(i).padStart(2, '0')}</div><h4>${t(`l.s${i}t`)}</h4><p>${t(`l.s${i}d`)}</p></div>`;
  const bullet = (txt: string): string => `<li><i data-lucide="check"></i><span>${txt}</span></li>`;
  const faq = (i: number): string =>
    `<details class="faq-item rv"><summary>${t(`l.q${i}`)}<i data-lucide="chevron-down"></i></summary><p>${t(`l.a${i}`)}</p></details>`;

  root.innerHTML = `
  <nav class="lnav" id="lnav">
    <div class="container lnav-in">
      <a class="brand js-home" href="#/"><span class="logo">◧</span><div>Tasvir&nbsp;AI</div></a>
      <div class="lnav-links">
        <a data-goto="features">${t('l.navFeatures')}</a>
        <a data-goto="roi">${t('roi.nav')}</a>
        <a data-goto="pricing">${t('l.navPricing')}</a>
        <a data-goto="faq">${t('l.navFaq')}</a>
        <a href="${GITHUB}#readme" target="_blank" rel="noopener">${t('l.navDocs')}</a>
      </div>
      <div class="lnav-right">
        ${langSwitchMarkup()}
        ${
          loggedIn
            ? `<button class="btn btn-primary js-app">${t('landing.openApp')}</button>`
            : `<button class="btn btn-ghost js-login">${t('landing.login')}</button><button class="btn btn-primary js-start">${t('landing.signup')}</button>`
        }
      </div>
    </div>
  </nav>

  <section class="hero2">
    <div class="container hero2-in">
      <div class="hero2-copy">
        <span class="hero-pill rv"><span class="hp-dot"></span>${t('l.heroBadge')}</span>
        <h1 class="rv"><span>${t('l.heroT1')}</span><span class="dim">${t('l.heroT2')}</span></h1>
        <p class="lead rv">${t('l.heroLead')}</p>
        <div class="hero-cta rv">
          ${startCta}
          <button class="btn btn-lg btn-glass magnetic js-demo"><i data-lucide="play"></i>${t('l.ctaDemo')}</button>
        </div>
        <div class="hero-stats rv">
          <div><b>${t('l.stat1v')}</b><span>${t('l.stat1k')}</span></div>
          <div><b>${t('l.stat2v')}</b><span>${t('l.stat2k')}</span></div>
          <div><b>${t('l.stat3v')}</b><span>${t('l.stat3k')}</span></div>
        </div>
      </div>
      <div class="hero2-visual rv">${heroWindow()}</div>
    </div>
  </section>

  <section class="works rv">
    <div class="container">
      <p>${t('l.works')}</p>
      <div class="wordmarks">
        <span>CorelDRAW</span><span>Illustrator</span><span>AutoCAD</span><span>LightBurn</span><span>Inkscape</span><span>PDF</span><span>DXF</span><span>DWG</span>
      </div>
      <p class="live-stats js-live" hidden></p>
    </div>
  </section>

  <section class="section" id="features">
    <div class="container">
      <div class="section-head rv"><h2>${t('l.featTitle')}</h2><p>${t('l.featSub')}</p></div>
      <div class="grid-3">
        ${feat(1, 'file-up')}${feat(2, 'puzzle')}${feat(3, 'scissors')}${feat(4, 'layers')}${feat(5, 'flip-horizontal-2')}${feat(6, 'download')}
      </div>
    </div>
  </section>

  <section class="section how2" id="how">
    <div class="container">
      <div class="section-head rv"><h2>${t('l.howTitle')}</h2></div>
      <div class="steps2">${step(1)}${step(2)}${step(3)}${step(4)}</div>
    </div>
  </section>

  <section class="section" id="compare">
    <div class="container">
      <div class="section-head rv"><h2>${t('l.cmpTitle')}</h2><p>${t('l.cmpSub')}</p></div>
      <div class="cmp rv">
        <div class="cmp-card before">
          <div class="cmp-tag">${t('l.cmpBefore')}</div>
          ${cmpSvg(false)}
          <div class="cmp-meta">${t('l.cmpBeforeMeta')}</div>
        </div>
        <div class="cmp-arrow"><i data-lucide="arrow-right"></i></div>
        <div class="cmp-card after">
          <div class="cmp-tag on">${t('l.cmpAfter')}</div>
          ${cmpSvg(true)}
          <div class="cmp-meta on">${t('l.cmpAfterMeta')}</div>
        </div>
      </div>
      <p class="cmp-note rv">${t('l.cmpNote')}</p>
    </div>
  </section>

  <section class="section" id="roi">
    <div class="container">
      <div class="section-head rv"><h2>${t('roi.title')}</h2><p>${t('roi.sub')}</p></div>
      <div class="roi rv">
        <div class="roi-in">
          <label class="roi-f"><span>${t('roi.sheets')}</span><input type="number" class="js-roi-sheets" value="30" min="1" max="100000" step="1" inputmode="numeric" /></label>
          <label class="roi-f"><span>${t('roi.price')}</span><input type="number" class="js-roi-price" value="300000" min="0" step="10000" inputmode="numeric" /></label>
          <label class="roi-f"><span>${t('roi.now')} <b class="js-roi-now-v">60%</b></span><input type="range" class="js-roi-now" min="30" max="90" value="60" /></label>
          <label class="roi-f"><span>${t('roi.new')} <b class="js-roi-new-v">75%</b></span><input type="range" class="js-roi-new" min="30" max="95" value="75" /></label>
        </div>
        <div class="roi-out">
          <div class="roi-k">${t('roi.savedSheets')}</div><div class="roi-v js-roi-sheets-out">—</div>
          <div class="roi-k">${t('roi.savedMonth')}</div><div class="roi-v big js-roi-month">—</div>
          <div class="roi-k">${t('roi.savedYear')}</div><div class="roi-v js-roi-year">—</div>
          <div class="roi-pay js-roi-pay"></div>
        </div>
      </div>
      <p class="cmp-note rv">${t('roi.note', { n: '<span class="js-free-n">7</span>' })}</p>
    </div>
  </section>

  <section class="section" id="pricing">
    <div class="container">
      <div class="section-head rv"><h2>${t('l.priceTitle')}</h2><p>${t('l.priceSub', { n: '<span class="js-free-n">7</span>' })}</p></div>
      <div class="rv" style="display:flex;justify-content:center">${periodPickerMarkup()}</div>
      <div class="pricing">
        <div class="price-card rv">
          <div class="pc-name">${t('l.pFreeName')}</div>
          <div class="pc-price">0 <small>${t('l.pTrialPer', { n: '<span class="js-free-n">7</span>' })}</small></div>
          <ul>${bullet(t('l.pFreeB1', { n: '<span class="js-free-n">7</span>' }))}${bullet(t('l.pFreeB2'))}${bullet(t('l.pFreeB3'))}</ul>
          <button class="btn btn-glass js-start-p">${t('l.pFreeCta')}</button>
        </div>
        <div class="price-card hot rv">
          <div class="pc-pop">${t('l.popular')}</div>
          <div class="pc-name">PRO</div>
          <div class="pc-price"><span class="js-pro-price">70 000</span> <small>${t('plan.perMonth')}</small></div>
          <div class="pl-total js-total" data-plan="PRO"></div>
          <ul>${bullet(t('plan.proB1', { n: '<span class="js-pro-credits">10 000</span>' }))}${bullet(t('plan.proB2'))}${bullet(t('plan.proB3'))}</ul>
          <a class="btn btn-primary js-buy" data-plan="PRO" href="${salesLink('dior_react')}" target="_blank" rel="noopener">${t('l.pBuyPro')}</a>
        </div>
        <div class="price-card rv">
          <div class="pc-name">VIP</div>
          <div class="pc-price"><span class="js-vip-price">150 000</span> <small>${t('plan.perMonth')}</small></div>
          <div class="pl-total js-total" data-plan="VIP"></div>
          <ul>${bullet(t('plan.vipB1'))}${bullet(t('plan.vipB2'))}${bullet(t('plan.vipB3'))}</ul>
          <a class="btn btn-glass js-buy" data-plan="VIP" href="${salesLink('dior_react')}" target="_blank" rel="noopener">${t('l.pBuyVip')}</a>
        </div>
      </div>
      <p class="cmp-note rv">${t('l.pBuyNote', { c: '<a class="js-buy js-buy-name" href="' + salesLink('dior_react') + '" target="_blank" rel="noopener">@dior_react</a>' })}</p>
    </div>
  </section>

  <section class="section" id="faq">
    <div class="container faq-wrap">
      <div class="section-head rv"><h2>${t('l.faqTitle')}</h2></div>
      ${faq(1)}${faq(2)}${faq(3)}${faq(4)}${faq(5)}${faq(6)}
    </div>
  </section>

  <footer class="footer2">
    <div class="container">
      <div class="f2-grid">
        <div class="f2-brand">
          <a class="brand js-home" href="#/"><span class="logo">◧</span><div>Tasvir&nbsp;AI</div></a>
          <p>${t('l.footDesc')}</p>
        </div>
        <div class="f2-col">
          <h5>${t('l.footProduct')}</h5>
          <a data-goto="features">${t('l.navFeatures')}</a>
          <a data-goto="pricing">${t('l.navPricing')}</a>
          <a data-goto="faq">${t('l.navFaq')}</a>
          <a class="js-app" href="#/app">${t('l.footApp')}</a>
        </div>
        <div class="f2-col">
          <h5>${t('l.footResources')}</h5>
          <a href="${GITHUB}#readme" target="_blank" rel="noopener">${t('l.navDocs')}</a>
          <a href="${GITHUB}" target="_blank" rel="noopener">${t('l.footGithub')}</a>
        </div>
      </div>
      <div class="f2-bottom"><span>${t('l.footRights')}</span>${langSwitchMarkup()}</div>
    </div>
  </footer>`;

  // --- routing buttons ---
  const go = (h: string) => (e: Event) => {
    e.preventDefault();
    navigate(h);
  };
  root.querySelectorAll<HTMLElement>('.js-start, .js-start-p').forEach((b) => b.addEventListener('click', go('#/login')));
  // ---- savings calculator: the user's own numbers, plain arithmetic ----
  let proPrice = 70_000;
  const roiEl = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;
  const roi = (): void => {
    const sheets = Math.max(0, Number(roiEl<HTMLInputElement>('.js-roi-sheets').value) || 0);
    const price = Math.max(0, Number(roiEl<HTMLInputElement>('.js-roi-price').value) || 0);
    const now = Number(roiEl<HTMLInputElement>('.js-roi-now').value) || 60;
    const next = Number(roiEl<HTMLInputElement>('.js-roi-new').value) || 75;
    roiEl('.js-roi-now-v').textContent = `${now}%`;
    roiEl('.js-roi-new-v').textContent = `${next}%`;
    // The same parts need area/fill of material: fewer sheets at a higher fill.
    const saved = next > now ? sheets * (1 - now / next) : 0;
    const month = saved * price;
    roiEl('.js-roi-sheets-out').textContent = saved.toFixed(saved < 10 ? 1 : 0);
    roiEl('.js-roi-month').textContent = t('roi.sum', { v: fmtSum(Math.round(month)) });
    roiEl('.js-roi-year').textContent = t('roi.sum', { v: fmtSum(Math.round(month * 12)) });
    roiEl('.js-roi-pay').textContent =
      month > 0 ? t('roi.payback', { d: Math.max(1, Math.ceil((30 * proPrice) / month)) }) : t('roi.paybackNone');
  };
  root.querySelectorAll<HTMLInputElement>('#roi input').forEach((inp) => inp.addEventListener('input', roi));
  roi();

  // Real usage totals — shown once there is something worth showing.
  void getStats().then((s) => {
    const el = root.querySelector<HTMLElement>('.js-live');
    if (!el || !s || s.nests < 50) return;
    el.innerHTML = t('l.live', {
      parts: `<b>${fmtSum(s.parts)}</b>`,
      nests: `<b>${fmtSum(s.nests)}</b>`,
      users: `<b>${fmtSum(s.users)}</b>`,
    });
    el.hidden = false;
  });

  // Live prices and the sales contact come from the admin's plan settings.
  void getConfig().then((cfg) => {
    proPrice = cfg.plans.pro.price;
    roi();
    const set = (sel: string, text: string): void => {
      root.querySelectorAll<HTMLElement>(sel).forEach((n) => {
        n.textContent = text;
      });
    };
    set('.js-free-n', String(cfg.trialDays));
    set('.js-pro-price', fmtSum(cfg.plans.pro.price));
    set('.js-vip-price', fmtSum(cfg.plans.vip.price));
    set('.js-pro-credits', fmtSum(cfg.plans.pro.credits));
    set('.js-buy-name', `@${cfg.salesContact}`);
    root.querySelectorAll<HTMLAnchorElement>('.js-buy:not([data-plan])').forEach((a) => {
      a.href = salesLink(cfg.salesContact);
    });
    const pricing = root.querySelector<HTMLElement>('#pricing');
    if (pricing) wirePeriods(pricing, cfg, null);
  });
  root.querySelectorAll<HTMLElement>('.js-login').forEach((b) => b.addEventListener('click', go('#/login')));
  root.querySelectorAll<HTMLElement>('.js-app').forEach((b) => b.addEventListener('click', go('#/app')));
  root.querySelectorAll<HTMLElement>('.js-home').forEach((b) => b.addEventListener('click', go('#/')));
  wireLangSwitch(root);

  // --- in-page anchors (cannot use location.hash: the hash IS the router) ---
  const scrollToId = (id: string): void => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  root.querySelectorAll<HTMLElement>('[data-goto]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      scrollToId(a.dataset.goto!);
    }),
  );
  root.querySelector('.js-demo')?.addEventListener('click', () => scrollToId('how'));

  // --- nav: glass once scrolled ---
  const nav = root.querySelector<HTMLElement>('#lnav');
  const onScroll = (): void => {
    nav?.classList.toggle('scrolled', window.scrollY > 12);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
  cleanupFns.push(() => window.removeEventListener('scroll', onScroll));

  // --- reveal on scroll (fade-up + blur, staggered within each container) ---
  const revealed = root.querySelectorAll<HTMLElement>('.rv');
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const el = en.target as HTMLElement;
        const siblings = Array.from(el.parentElement?.children ?? []).filter((c) => c.classList.contains('rv'));
        el.style.transitionDelay = `${Math.min(siblings.indexOf(el), 5) * 70}ms`;
        el.classList.add('on');
        io.unobserve(el);
      }
    },
    { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
  );
  revealed.forEach((el) => io.observe(el));
  cleanupFns.push(() => io.disconnect());

  // --- magnetic buttons ---
  root.querySelectorAll<HTMLElement>('.magnetic').forEach((btn) => {
    const move = (e: MouseEvent): void => {
      const r = btn.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      btn.style.transform = `translate(${dx * 0.14}px, ${dy * 0.22}px)`;
    };
    const reset = (): void => {
      btn.style.transform = '';
    };
    btn.addEventListener('mousemove', move);
    btn.addEventListener('mouseleave', reset);
  });

  // --- hero mouse parallax on the app-window mockup ---
  const wrap = root.querySelector<HTMLElement>('#mwWrap');
  const win = root.querySelector<HTMLElement>('#mockWin');
  if (wrap && win && matchMedia('(pointer:fine)').matches) {
    const onMove = (e: MouseEvent): void => {
      const r = wrap.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      win.style.transform = `rotateY(${x * 5}deg) rotateX(${-y * 4}deg) translateZ(0)`;
    };
    const onLeave = (): void => {
      win.style.transform = '';
    };
    wrap.addEventListener('mousemove', onMove);
    wrap.addEventListener('mouseleave', onLeave);
  }

  // --- cut-path "laser head" riding the dashed line ---
  const cut = root.querySelector<SVGPathElement>('.cutline');
  const head = root.querySelector<SVGCircleElement>('.cuthead');
  if (cut && head) {
    const len = cut.getTotalLength();
    let raf = 0;
    let start = 0;
    const tick = (ts: number): void => {
      if (!start) start = ts;
      const p = cut.getPointAtLength((((ts - start) / 6000) % 1) * len);
      head.setAttribute('cx', String(p.x));
      head.setAttribute('cy', String(p.y));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    cleanupFns.push(() => cancelAnimationFrame(raf));
  }
}
