/**
 * Wheel-zoom + drag-pan for the result viewport. The transform is applied to a
 * persistent host element (not the SVG, which is replaced on every render), so
 * zoom controls and listeners survive re-renders. Call fit() after new content.
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

const MIN = 0.15;
const MAX = 40;

export function createZoomPan(viewport: HTMLElement, host: HTMLElement, ui: ZoomPanUi): ZoomPan {
  let scale = 1;
  let tx = 0;
  let ty = 0;

  const clamp = (v: number): number => Math.max(MIN, Math.min(MAX, v));
  const apply = (): void => {
    host.style.transformOrigin = '0 0';
    host.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${scale})`;
    ui.level.textContent = `${Math.round(scale * 100)}%`;
  };
  const measureFit = (): void => {
    const svg = host.querySelector('svg');
    const vr = viewport.getBoundingClientRect();
    if (!svg || vr.width < 2 || vr.height < 2) {
      scale = 1;
      tx = 0;
      ty = 0;
      apply();
      return;
    }
    // Derive the content's natural size from the viewBox aspect ratio, not from the
    // SVG's rendered box: a width:100% SVG reports its intrinsic viewBox width until
    // the flex cell's width is fully resolved, which throws the fit scale off.
    const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    const aspect = vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? vb[3] / vb[2] : 0;
    const natW = vr.width; // host is width:100% of the viewport
    const natH = aspect ? natW * aspect : (svg.getBoundingClientRect().height || 1);
    scale = clamp(Math.min(vr.width / natW, vr.height / natH) * 0.94);
    tx = (vr.width - natW * scale) / 2;
    ty = (vr.height - natH * scale) / 2;
    apply();
  };

  /**
   * Scales the content to fit the viewport and centres it. Deferred one frame so
   * the measurement reads the settled layout (the flex viewport is still sizing
   * when render() calls fit() immediately after swapping in new content).
   */
  let fitRaf = 0;
  const fit = (): void => {
    if (fitRaf) cancelAnimationFrame(fitRaf);
    fitRaf = requestAnimationFrame(() => {
      fitRaf = 0;
      measureFit();
    });
  };

  /** Zoom keeping the point (cx,cy) — in viewport pixels — anchored. */
  const zoomAt = (cx: number, cy: number, factor: number): void => {
    const ns = clamp(scale * factor);
    if (ns === scale) return;
    tx = cx - ((cx - tx) / scale) * ns;
    ty = cy - ((cy - ty) / scale) * ns;
    scale = ns;
    apply();
  };
  const centerZoom = (factor: number): void => {
    const r = viewport.getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, factor);
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.14 : 1 / 1.14);
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
    if (!dragging) return;
    tx += e.clientX - lx;
    ty += e.clientY - ly;
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

  apply();

  return {
    fit,
    destroy() {
      if (fitRaf) cancelAnimationFrame(fitRaf);
      viewport.removeEventListener('wheel', onWheel);
      viewport.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    },
  };
}
