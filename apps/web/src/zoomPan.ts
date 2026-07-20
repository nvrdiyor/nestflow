/**
 * Wheel-zoom + drag-pan for the result viewport — implemented by windowing the
 * SVG's own viewBox rather than CSS-transforming a rasterised layer, so the
 * drawing stays VECTOR-SHARP at any zoom level (a CSS scale() blurs badly once
 * the browser caches the layer at 1×).
 *
 * The host's <svg> is replaced on every render; call fit() after new content —
 * it re-reads the fresh element's full viewBox as the 100% window.
 */
export interface ZoomPanUi {
  in: HTMLElement;
  out: HTMLElement;
  fit: HTMLElement;
  level: HTMLElement;
}

export interface ZoomPan {
  fit(): void;
  destroy(): void;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_SCALE = 0.4;
const MAX_SCALE = 80;

export function createZoomPan(viewport: HTMLElement, host: HTMLElement, ui: ZoomPanUi): ZoomPan {
  let full: Box | null = null; // the drawing's own viewBox = 100%
  let win: Box | null = null; // current visible window

  const svgEl = (): SVGSVGElement | null => host.querySelector('svg');

  const apply = (): void => {
    const s = svgEl();
    if (!s || !win || !full) return;
    s.setAttribute('viewBox', `${win.x.toFixed(3)} ${win.y.toFixed(3)} ${win.w.toFixed(3)} ${win.h.toFixed(3)}`);
    ui.level.textContent = `${Math.round((full.w / win.w) * 100)}%`;
  };

  /** Re-reads the CURRENT svg's full drawing box and shows all of it. */
  const fit = (): void => {
    const s = svgEl();
    if (!s) {
      full = null;
      win = null;
      ui.level.textContent = '100%';
      return;
    }
    // The original viewBox is stashed on first sight — we mutate the live one.
    const orig = s.dataset.vb0 ?? s.getAttribute('viewBox') ?? '';
    s.dataset.vb0 = orig;
    const v = orig.split(/[\s,]+/).map(Number);
    if (v.length !== 4 || !(v[2]! > 0) || !(v[3]! > 0)) {
      full = null;
      win = null;
      return;
    }
    full = { x: v[0]!, y: v[1]!, w: v[2]!, h: v[3]! };
    win = { ...full };
    apply();
  };

  /** px-per-user-unit of the current rendering (aspect-fit letterboxing aware). */
  const pxScale = (rect: DOMRect): number => (win ? Math.min(rect.width / win.w, rect.height / win.h) : 1);

  const clampScale = (wantW: number): number => {
    if (!full) return wantW;
    return Math.min(full.w / MIN_SCALE, Math.max(full.w / MAX_SCALE, wantW));
  };

  /** Zoom keeping the viewport point (px,py in client coords) anchored. */
  const zoomAt = (clientX: number, clientY: number, factor: number): void => {
    const s = svgEl();
    if (!s || !win || !full) return;
    const rect = s.getBoundingClientRect();
    const k = pxScale(rect);
    const contentW = win.w * k;
    const contentH = win.h * k;
    const offX = (rect.width - contentW) / 2;
    const offY = (rect.height - contentH) / 2;
    const ux = win.x + (clientX - rect.left - offX) / k;
    const uy = win.y + (clientY - rect.top - offY) / k;
    const newW = clampScale(win.w / factor);
    const ratio = newW / win.w;
    win = {
      x: ux - (ux - win.x) * ratio,
      y: uy - (uy - win.y) * ratio,
      w: newW,
      h: win.h * ratio,
    };
    apply();
  };

  const centerZoom = (factor: number): void => {
    const r = viewport.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.14 : 1 / 1.14);
  };

  let dragging = false;
  let lx = 0;
  let ly = 0;
  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    dragging = true;
    lx = e.clientX;
    ly = e.clientY;
    viewport.classList.add('grabbing');
  };
  const onMove = (e: PointerEvent): void => {
    if (!dragging || !win) return;
    const s = svgEl();
    if (!s) return;
    const k = pxScale(s.getBoundingClientRect());
    win.x -= (e.clientX - lx) / k;
    win.y -= (e.clientY - ly) / k;
    lx = e.clientX;
    ly = e.clientY;
    apply();
  };
  const onUp = (): void => {
    dragging = false;
    viewport.classList.remove('grabbing');
  };

  viewport.addEventListener('wheel', onWheel, { passive: false });
  viewport.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  ui.in.addEventListener('click', () => centerZoom(1.25));
  ui.out.addEventListener('click', () => centerZoom(1 / 1.25));
  ui.fit.addEventListener('click', fit);

  return {
    fit,
    destroy() {
      viewport.removeEventListener('wheel', onWheel);
      viewport.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    },
  };
}
