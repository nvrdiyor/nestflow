import { ringBounds, type Part, type Ring } from '@nestflow/engine';
import { colorFor } from './colors';
import { t } from './i18n';
import { ROTATION_STEPS, type LoadedFile, type PartOverride } from './job';

/**
 * The job panel: the drawings in the job (add more, remove one, pick which one
 * the real-size fields resize, switch DXF layers on/off) and the list of
 * detected parts — a thumbnail, true size, how many to cut and how each part
 * may turn (grain / text direction), or leave a part out altogether.
 */

export interface PartsPanelHandlers {
  quantity(id: string, qty: number): void;
  rotation(id: string, step: string): void;
  multiply(k: number): void;
  resetQuantities(): void;
  activateFile(index: number): void;
  removeFile(index: number): void;
  addFile(): void;
  clear(): void;
  layer(index: number, layer: string, cut: boolean): void;
  highlight(id: string | null): void;
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'));

function ringD(r: Ring): string {
  let d = '';
  for (let i = 0; i < r.length; i++) d += `${i ? 'L' : 'M'}${r[i]!.x.toFixed(1)} ${r[i]!.y.toFixed(1)}`;
  return d + 'Z';
}

function thumb(p: Part): string {
  const b = ringBounds(p.contour.outer);
  const w = Math.max(1e-3, b.maxX - b.minX);
  const h = Math.max(1e-3, b.maxY - b.minY);
  const pad = Math.max(w, h) * 0.06;
  const d = ringD(p.contour.outer) + p.contour.holes.map(ringD).join('');
  return `<svg viewBox="${(b.minX - pad).toFixed(1)} ${(b.minY - pad).toFixed(1)} ${(w + 2 * pad).toFixed(1)} ${(h + 2 * pad).toFixed(1)}" preserveAspectRatio="xMidYMid meet"><path d="${d}" fill="${colorFor(p.id)}" fill-rule="evenodd"/></svg>`;
}

const PAGE = 150;

export function createPartsPanel(host: HTMLElement, h: PartsPanelHandlers) {
  let shown = PAGE;
  let files: LoadedFile[] = [];
  let overrides = new Map<string, PartOverride>();
  let active = 0;
  let openLayers = -1;

  const rotLabel = (s: string): string => (s === '' ? t('parts.rotJob') : s === '0' ? t('parts.rotNone') : `${s}°`);

  const render = (): void => {
    if (!files.length) {
      host.innerHTML = '';
      host.hidden = true;
      return;
    }
    host.hidden = false;
    let kinds = 0;
    let total = 0;
    const rows: string[] = [];
    let n = 0;
    for (const f of files) {
      for (const p of f.parts) {
        const o = overrides.get(p.id);
        const qty = o?.qty ?? p.quantity ?? 1;
        if (qty > 0) {
          kinds++;
          total += qty;
        }
        n++;
        if (n > shown) continue;
        const b = ringBounds(p.contour.outer);
        const rot = o?.rot ?? '';
        rows.push(`<div class="pt-row${qty <= 0 ? ' off' : ''}" data-id="${esc(p.id)}">
          <div class="pt-thumb">${thumb(p)}</div>
          <div class="pt-body">
          <div class="pt-info"><b>#${n}</b><small>${Math.round(b.maxX - b.minX)}×${Math.round(b.maxY - b.minY)} mm</small></div>
          <div class="pt-ctl">
          <input class="pt-qty" type="number" min="0" max="100000" step="1" value="${qty}" aria-label="${esc(t('parts.qty'))}" title="${esc(t('parts.qty'))}" />
          <select class="pt-rot" aria-label="${esc(t('parts.rot'))}" title="${esc(t('parts.rot'))}">
            ${['', ...ROTATION_STEPS].map((s) => `<option value="${s}"${s === rot ? ' selected' : ''}>${esc(rotLabel(s))}</option>`).join('')}
          </select>
          </div>
          </div>
          <button type="button" class="pt-del icon-btn" title="${esc(qty > 0 ? t('parts.remove') : t('parts.restore'))}" aria-label="${esc(qty > 0 ? t('parts.remove') : t('parts.restore'))}">${qty > 0 ? '✕' : '↺'}</button>
        </div>`);
      }
    }
    const more = n > shown ? `<button type="button" class="link pt-more">${esc(t('parts.more', { n: n - shown }))}</button>` : '';
    const fileRows = files
      .map((f, i) => {
        const layers =
          f.layers.length > 1
            ? `<details class="pf-layers"${openLayers === i ? ' open' : ''} data-i="${i}"><summary>${esc(t('parts.layers', { n: f.layers.length - f.layersOff.length, total: f.layers.length }))}</summary>
              ${f.layers
                .map(
                  (l) =>
                    `<label class="check pf-layer"><input type="checkbox" data-layer="${esc(l.name)}"${f.layersOff.includes(l.name) ? '' : ' checked'} /> <span>${esc(l.name)} <small>(${l.count})</small></span></label>`,
                )
                .join('')}
              <p class="hint">${esc(t('parts.layersHint'))}</p>
            </details>`
            : '';
        return `<div class="pf-row${i === active ? ' active' : ''}" data-i="${i}">
          <button type="button" class="pf-main" title="${esc(t('parts.activate'))}"><b>${esc(f.name)}</b><small>${Math.round(f.w)}×${Math.round(f.h)} mm · ${esc(t('parts.pcs', { n: f.parts.reduce((s, p) => s + Math.max(0, overrides.get(p.id)?.qty ?? p.quantity ?? 1), 0) }))}</small></button>
          <button type="button" class="pf-del icon-btn" title="${esc(t('parts.removeFile'))}" aria-label="${esc(t('parts.removeFile'))}">✕</button>
          ${layers}
        </div>`;
      })
      .join('');
    host.innerHTML = `
      <div class="pf-list">${fileRows}</div>
      <div class="pf-actions">
        <button type="button" class="link pf-add">+ ${esc(t('parts.addFile'))}</button>
        <button type="button" class="link pf-clear">${esc(t('parts.clear'))}</button>
      </div>
      <details class="pt-box" open>
        <summary>${esc(t('parts.title', { kinds, total }))}</summary>
        <div class="pt-bulk">
          <span>${esc(t('parts.all'))}</span>
          <button type="button" class="pt-mul" data-k="2">×2</button>
          <button type="button" class="pt-mul" data-k="5">×5</button>
          <button type="button" class="pt-mul" data-k="10">×10</button>
          <button type="button" class="pt-reset">${esc(t('parts.reset'))}</button>
        </div>
        <div class="pt-list">${rows.join('')}${more}</div>
      </details>`;
  };

  host.addEventListener('change', (e) => {
    const el = e.target as HTMLElement;
    const row = el.closest<HTMLElement>('.pt-row');
    if (row && el.classList.contains('pt-qty')) {
      const v = Math.max(0, Math.min(100000, Math.round(Number((el as HTMLInputElement).value) || 0)));
      h.quantity(row.dataset.id!, v);
    } else if (row && el.classList.contains('pt-rot')) {
      h.rotation(row.dataset.id!, (el as HTMLSelectElement).value);
    } else if (el.matches('.pf-layer input')) {
      const i = Number(el.closest<HTMLElement>('.pf-layers')!.dataset.i);
      openLayers = i;
      h.layer(i, (el as HTMLInputElement).dataset.layer!, (el as HTMLInputElement).checked);
    }
  });
  host.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    const row = el.closest<HTMLElement>('.pt-row');
    if (row && el.closest('.pt-del')) {
      const id = row.dataset.id!;
      const f = files.find((x) => x.parts.some((p) => p.id === id));
      const part = f?.parts.find((p) => p.id === id);
      const cur = overrides.get(id)?.qty ?? part?.quantity ?? 1;
      h.quantity(id, cur > 0 ? 0 : part?.quantity ?? 1);
      return;
    }
    const fileRow = el.closest<HTMLElement>('.pf-row');
    if (fileRow && el.closest('.pf-del')) {
      h.removeFile(Number(fileRow.dataset.i));
      return;
    }
    if (fileRow && el.closest('.pf-main')) {
      h.activateFile(Number(fileRow.dataset.i));
      return;
    }
    if (el.closest('.pf-add')) h.addFile();
    else if (el.closest('.pf-clear')) h.clear();
    else if (el.closest('.pt-mul')) h.multiply(Number((el.closest('.pt-mul') as HTMLElement).dataset.k));
    else if (el.closest('.pt-reset')) h.resetQuantities();
    else if (el.closest('.pt-more')) {
      shown += PAGE * 4;
      render();
    }
  });
  host.addEventListener('mouseover', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.pt-row');
    h.highlight(row?.dataset.id ?? null);
  });
  host.addEventListener('mouseleave', () => h.highlight(null));

  return {
    update(next: { files: LoadedFile[]; overrides: Map<string, PartOverride>; active: number }): void {
      if (next.files !== files) shown = PAGE;
      files = next.files;
      overrides = next.overrides;
      active = next.active;
      render();
    },
  };
}
