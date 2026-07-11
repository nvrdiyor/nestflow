import '@fontsource-variable/inter';
import 'aos/dist/aos.css';
import './app.css';
import './style.css';
import AOS from 'aos';
import {
  createIcons,
  ArrowRight,
  Download,
  LayoutGrid,
  Puzzle,
  Ruler,
  Scissors,
  Settings2,
  Sparkles,
  Type,
  Upload,
} from 'lucide';
import { isLoggedIn } from './api';
import { getLang } from './i18n';
import { renderLanding } from './views/landing';
import { renderAuth } from './views/auth';
import { renderApp } from './views/app';
import { renderAdmin } from './views/admin';

const root = document.getElementById('app') as HTMLElement;
let cleanup: (() => void) | null = null;

const LUCIDE = { ArrowRight, Download, LayoutGrid, Puzzle, Ruler, Scissors, Settings2, Sparkles, Type, Upload };
AOS.init({ duration: 620, easing: 'ease-out-cubic', once: true, offset: 40 });

/** Swap in Lucide icons and (re)collect AOS reveal targets after a view renders. */
function enhance(): void {
  createIcons({ icons: LUCIDE, attrs: { 'stroke-width': '1.6' } });
  AOS.refreshHard();
}

function navigate(hash: string): void {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function route(): void {
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
  const path = (location.hash || '#/').replace(/^#/, '');
  root.innerHTML = '';
  window.scrollTo(0, 0);

  switch (path) {
    case '':
    case '/':
      renderLanding(root, navigate);
      enhance();
      return;
    case '/login':
      renderAuth(root, navigate, 'login');
      enhance();
      return;
    case '/register':
      renderAuth(root, navigate, 'register');
      enhance();
      return;
    case '/app':
      if (!isLoggedIn()) {
        location.hash = '#/login';
        return;
      }
      cleanup = renderApp(root, navigate);
      enhance();
      return;
    case '/admin':
      renderAdmin(root, navigate);
      enhance();
      return;
    default:
      location.hash = '#/';
  }
}

document.documentElement.lang = getLang();
window.addEventListener('hashchange', route);
window.addEventListener('nf-langchange', route); // re-render current view in the new language
route();
