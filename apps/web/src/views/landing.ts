import { isLoggedIn } from '../api';
import { STARTING_CREDITS } from '../cost';

type Nav = (hash: string) => void;

const HERO_SVG = `
<svg viewBox="0 0 900 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Illustration of parts nested tightly on a cutting sheet">
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
  const user = isLoggedIn();
  const primaryCta = user
    ? `<button class="btn btn-primary btn-lg js-app">Open the app →</button>`
    : `<button class="btn btn-primary btn-lg js-start">Get started free →</button>`;

  root.innerHTML = `
  <header class="container landing-nav">
    <a class="brand js-home" href="#/"><span class="logo">◧</span><div>NestFlow&nbsp;AI<small>NESTING PLATFORM</small></div></a>
    <div style="display:flex;gap:10px;align-items:center">
      ${user ? `<button class="btn btn-ghost js-app">Open app</button>` : `<button class="btn btn-ghost js-login">Log in</button><button class="btn btn-primary js-start">Sign up</button>`}
    </div>
  </header>

  <section class="hero">
    <div class="container">
      <span class="eyebrow">CNC · Laser · Plotter</span>
      <h1>Cut more parts from <span class="grad">less material</span>.</h1>
      <p class="lead">NestFlow arranges your letters, logos and parts on the sheet automatically — packing them as tightly as possible so you save material, time and money on every cut.</p>
      <div class="hero-cta">
        ${primaryCta}
        <a class="btn btn-lg js-how" href="#how">How it works</a>
      </div>
      <div class="hero-figure">${HERO_SVG}</div>
    </div>
  </section>

  <section class="section" id="features">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">Features</span>
        <h2>Built for real cutting shops</h2>
        <p>Everything you need to turn a design into an optimised, machine-ready cut.</p>
      </div>
      <div class="grid-3">
        <div class="feature"><div class="ic">🔤</div><h3>Cut letters &amp; text</h3><p>Type a word and NestFlow turns each letter into a vector part — counters (A, O, e) cut out — then packs them tightly.</p></div>
        <div class="feature"><div class="ic">📥</div><h3>Import SVG &amp; DXF</h3><p>Drop your files. Curves, arcs and bulges are flattened, holes detected, and loose lines chained into closed parts.</p></div>
        <div class="feature"><div class="ic">🧩</div><h3>True irregular nesting</h3><p>No-Fit-Polygon engine with genetic-algorithm search fits parts into every gap — even inside the holes of other parts.</p></div>
        <div class="feature"><div class="ic">✂️</div><h3>Common-line cutting</h3><p>Shared edges between parts are cut once, not twice — less cutting, shorter machine time, less waste.</p></div>
        <div class="feature"><div class="ic">📐</div><h3>Multi-sheet &amp; rotation</h3><p>Parts overflow to new sheets automatically and rotate to fit. Set spacing, kerf and margins to match your machine.</p></div>
        <div class="feature"><div class="ic">📤</div><h3>Export to machine</h3><p>Download the nested layout as SVG or DXF in millimetres — ready for your laser, router or plotter.</p></div>
      </div>
    </div>
  </section>

  <section class="section" id="how" style="background:var(--bg-2);border-block:1px solid var(--line)">
    <div class="container">
      <div class="section-head"><span class="eyebrow">How it works</span><h2>From word to cut in four steps</h2></div>
      <div class="steps">
        <div class="step"><div class="num">1</div><h4>Add your parts</h4><p>Type letters, or upload an SVG/DXF file.</p></div>
        <div class="step"><div class="num">2</div><h4>Set the sheet</h4><p>Material size, spacing, kerf and rotations.</p></div>
        <div class="step"><div class="num">3</div><h4>Nest</h4><p>The engine packs everything in seconds.</p></div>
        <div class="step"><div class="num">4</div><h4>Export</h4><p>Download a machine-ready DXF or SVG.</p></div>
      </div>
    </div>
  </section>

  <section class="section" id="credits">
    <div class="container">
      <div class="section-head"><span class="eyebrow">Credits</span><h2>Simple, transparent pricing</h2><p>Every new account starts with <b>${STARTING_CREDITS} free credits</b>. Each nest costs credits based on job size and how hard the engine searches.</p></div>
      <div class="credits-box">
        <div class="credits-formula">cost = strategyBase + ⌈ parts ÷ 15 ⌉&nbsp;&nbsp;&nbsp;(Fast = 1, Balanced = 3, Max saving = 6)</div>
        <div class="credit-examples">
          <div class="credit-ex"><div class="n">2<small> cr</small></div><div class="d">10 parts · Fast</div></div>
          <div class="credit-ex"><div class="n">7<small> cr</small></div><div class="d">47 parts · Balanced</div></div>
          <div class="credit-ex"><div class="n">13<small> cr</small></div><div class="d">100 parts · Max saving</div></div>
        </div>
      </div>
      <div style="text-align:center;margin-top:32px">${primaryCta}</div>
    </div>
  </section>

  <footer class="footer">
    <div class="container">
      <span>NestFlow AI — intelligent nesting for CNC / laser / plotter.</span>
      <span>Demo build · data stored in your browser</span>
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
}
