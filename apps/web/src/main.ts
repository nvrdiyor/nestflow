import './app.css';
import './style.css';
import { isLoggedIn } from './api';
import { renderLanding } from './views/landing';
import { renderAuth } from './views/auth';
import { renderApp } from './views/app';
import { renderAdmin } from './views/admin';

const root = document.getElementById('app') as HTMLElement;
let cleanup: (() => void) | null = null;

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
      return;
    case '/login':
      renderAuth(root, navigate, 'login');
      return;
    case '/register':
      renderAuth(root, navigate, 'register');
      return;
    case '/app':
      if (!isLoggedIn()) {
        location.hash = '#/login';
        return;
      }
      cleanup = renderApp(root, navigate);
      return;
    case '/admin':
      renderAdmin(root, navigate);
      return;
    default:
      location.hash = '#/';
  }
}

window.addEventListener('hashchange', route);
route();
