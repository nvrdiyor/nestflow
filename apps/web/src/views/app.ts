import {
  cutMetrics,
  planCutPath,
  resultToSVG,
  type CutMetrics,
  type CutPlan,
  type NestConfig,
  type NestResult,
  type Part,
  type Strategy,
} from '@nestflow/engine';
import { buildSampleSet, type SampleKey } from '../samples';
import { importSvgParts } from '../svgImport';
import { importDxfParts } from '../dxfImport';
import { textToParts } from '../textToParts';
import { exportDxf, exportSvg } from '../exporters';
import { appNavMarkup } from '../ui/nav';
import * as api from '../api';
import { nestCost } from '../cost';
import { estimateSheet, fitToParts } from '../autofit';
import { previewSvg } from '../preview';
import { t, wireLangSwitch } from '../i18n';
import type { VectorSource } from '../importCommon';
import { partSvgFor } from '../sourceRender';
import { createZoomPan, type ZoomPan } from '../zoomPan';
import { mirrorParts, mirrorSources } from '../mirror';

type Nav = (hash: string) => void;

const toolMarkup = (): string => `
<div class="tool-view"><main class="layout">
  <aside class="panel">
    <section class="group">
      <h2>${t('app.yourParts')}</h2>
      <div id="drop" class="drop">
        <input id="file" type="file" accept=".svg,.dxf,image/svg+xml" hidden />
        <span class="drop-ic">⬆</span>
        <span>${t('app.dropHere')} <button type="button" id="browse" class="link">${t('app.browse')}</button></span>
      </div>
      <div class="row"><label class="field"><span>${t('app.scale')}</span><input id="scale" type="number" value="1" min="0.01" step="0.1" /></label></div>
      <div class="textgen">
        <label class="field"><span>${t('app.typeLetters')}</span><input id="text" type="text" value="ASSALOMU ALEYKUM" /></label>
        <div class="row">
          <label class="field"><span>${t('app.letterHeight')}</span><input id="letterH" type="number" value="80" min="5" step="5" /></label>
          <button id="makeText" class="secondary">${t('app.makeLetters')}</button>
        </div>
      </div>
      <p id="importInfo" class="hint">${t('app.usingSample')}</p>
    </section>
    <section class="group">
      <h2>${t('app.sampleSet')}</h2>
      <label class="field"><span>${t('app.orPickDemo')}</span>
        <select id="sampleSet">
          <option value="signshop">Sign shop</option>
          <option value="letters">Letters &amp; rings</option>
          <option value="rects">Rectangles &amp; bars</option>
          <option value="dense">Dense mixed</option>
        </select>
      </label>
    </section>
    <section class="group">
      <h2>${t('app.sheet')}</h2>
      <label class="field" style="margin-bottom:10px"><span>${t('app.machine')}</span>
        <select id="machinePreset">
          <option value="custom">${t('app.custom')}</option>
          <option value="laser">Lazer — 1210 × 900 · 2mm</option>
          <option value="rover">Rover — 2400 × 1200 · 10mm</option>
        </select>
      </label>
      <label class="check" style="margin-bottom:10px"><input id="fitSheet" type="checkbox" checked /> <span>${t('app.fitSheet')}</span></label>
      <div class="row">
        <label class="field"><span>${t('app.width')}</span><input id="sheetW" type="number" value="800" min="50" step="10" /></label>
        <label class="field"><span>${t('app.height')}</span><input id="sheetH" type="number" value="600" min="50" step="10" /></label>
      </div>
      <div class="row">
        <label class="field"><span>${t('app.margin')}</span><input id="margin" type="number" value="5" min="0" step="1" /></label>
        <label class="field"><span>${t('app.sheetCost')}</span><input id="sheetCost" type="number" value="45" min="0" step="1" /></label>
      </div>
    </section>
    <section class="group">
      <h2>${t('app.cutting')}</h2>
      <div class="row">
        <label class="field"><span>${t('app.spacing')}</span><input id="spacing" type="number" value="3" min="0" step="0.5" /></label>
        <label class="field"><span>${t('app.kerf')}</span><input id="kerf" type="number" value="0.2" min="0" step="0.1" /></label>
      </div>
      <label class="check"><input id="holeFilling" type="checkbox" checked /> <span>${t('app.fillHoles')}</span></label>
      <label class="check" style="margin-top:10px"><input id="mirror" type="checkbox" /> <span>${t('app.mirror')}</span></label>
      <p class="hint" style="margin-top:6px">${t('app.mirrorHint')}</p>
    </section>
    <section class="group">
      <h2>${t('app.rotations')}</h2>
      <div class="chips">
        <label class="chip"><input type="checkbox" class="rot" value="0" checked />0°</label>
        <label class="chip"><input type="checkbox" class="rot" value="90" checked />90°</label>
        <label class="chip"><input type="checkbox" class="rot" value="180" checked />180°</label>
        <label class="chip"><input type="checkbox" class="rot" value="270" checked />270°</label>
      </div>
    </section>
    <section class="group">
      <h2>${t('app.optimization')}</h2>
      <div class="segmented" id="strategy">
        <button data-val="fast" class="active">${t('app.fast')}</button>
        <button data-val="balanced">${t('app.balanced')}</button>
        <button data-val="max">${t('app.maxSaving')}</button>
      </div>
      <label class="check" style="margin-top:12px"><input id="showPath" type="checkbox" /> <span>${t('app.showPath')}</span></label>
    </section>
    <button id="run" class="primary">${t('app.nestLayout')}</button>
    <p id="status" class="status"></p>
    <section class="group">
      <h2>${t('app.export')}</h2>
      <div class="exports">
        <button id="exportSvg" class="secondary" disabled>${t('app.downloadSvg')}</button>
        <button id="exportDxf" class="secondary" disabled>${t('app.downloadDxf')}</button>
      </div>
    </section>
  </aside>
  <section class="stage">
    <div class="metrics" id="metrics"></div>
    <div class="viewport" id="viewport">
      <div class="svg-host" id="svgHost"></div>
      <div class="zoom-ctl">
        <button class="js-zoom-out" title="Zoom out" aria-label="Zoom out"><i data-lucide="zoom-out"></i></button>
        <span class="lvl js-zoom-lvl">100%</span>
        <button class="js-zoom-in" title="Zoom in" aria-label="Zoom in"><i data-lucide="zoom-in"></i></button>
        <button class="js-zoom-fit" title="Fit" aria-label="Fit to view"><i data-lucide="maximize"></i></button>
      </div>
    </div>
  </section>
</main></div>`;

export function renderApp(root: HTMLElement, navigate: Nav): () => void {
  const user = api.cachedUser();
  if (!api.isLoggedIn() || !user) {
    navigate('#/login');
    return () => {};
  }
  root.innerHTML = appNavMarkup(user) + toolMarkup();

  const worker = new Worker(new URL('../nest.worker.ts', import.meta.url), { type: 'module' });
  const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
  const num = (id: string): number => Number(el<HTMLInputElement>(id).value) || 0;
  const checked = (id: string): boolean => el<HTMLInputElement>(id).checked;

  let strategy: Strategy = 'fast';
  let mode: 'sample' | 'imported' = 'sample';
  let importedParts: Part[] = [];
  let importedText: string | null = null;
  let importedName = '';
  let lastParts: Part[] = [];
  let lastResult: NestResult | null = null;
  let lastPlans: CutPlan[] = [];
  let sources = new Map<string, VectorSource>();
  let zoom: ZoomPan | null = null;
  let busy = false;
  let runCtx: { instances: number; strategy: Strategy; cost: number; parts: Part[] } | null = null;

  const statusEl = el('status');
  const runBtn = el<HTMLButtonElement>('run');
  const viewport = el('viewport');
  const metricsEl = el('metrics');
  const importInfo = el('importInfo');
  const exportSvgBtn = el<HTMLButtonElement>('exportSvg');
  const exportDxfBtn = el<HTMLButtonElement>('exportDxf');
  const creditsEl = root.querySelector<HTMLElement>('.js-credits');

  const mirrorOn = (): boolean => checked('mirror');
  // Keeps the "Mirrored" reminder in the status line while mirror stays on.
  const readyLabel = (): string => (mirrorOn() ? t('app.mirrorOn') : t('app.ready'));

  const currentParts = (): Part[] => {
    const base =
      mode === 'imported' && importedParts.length
        ? importedParts
        : buildSampleSet(el<HTMLSelectElement>('sampleSet').value as SampleKey);
    return mirrorOn() ? mirrorParts(base) : base;
  };

  // Exact SVG geometry, reflected to match the mirrored parts when mirror is on.
  const currentSources = (): Map<string, VectorSource> => (mirrorOn() ? mirrorSources(sources) : sources);

  const instanceCount = (parts: Part[]): number => parts.reduce((s, p) => s + (p.quantity ?? 1), 0);

  const fitEnabled = (): boolean => checked('fitSheet');

  const currentConfig = (): NestConfig => {
    const rotations = Array.from(document.querySelectorAll<HTMLInputElement>('.rot:checked')).map((r) => Number(r.value));
    const timeLimitMs = strategy === 'max' ? 8000 : strategy === 'balanced' ? 4000 : undefined;
    // In fit-to-parts mode the packer runs on a generous auto-sized sheet so it
    // clusters everything on one sheet; the result is then cropped to the pack.
    const sheet = fitEnabled()
      ? { ...estimateSheet(currentParts()), margin: num('margin'), cost: num('sheetCost') }
      : { width: num('sheetW'), height: num('sheetH'), margin: num('margin'), cost: num('sheetCost') };
    const config: NestConfig = {
      sheet,
      units: 'mm',
      rotations: rotations.length ? rotations : [0],
      spacing: num('spacing'),
      kerf: num('kerf'),
      holeFilling: checked('holeFilling'),
      strategy,
      seed: 12345,
      machine: { cutSpeed: 25, travelSpeed: 200, hourlyRate: 75, pierceTime: 0.4 },
    };
    if (timeLimitMs) config.timeLimitMs = timeLimitMs;
    return config;
  };

  const updateCostLabel = (): void => {
    const cost = nestCost(instanceCount(currentParts()), strategy);
    runBtn.textContent = `${t('app.nestLayout')} · ${cost} ${t('nav.credits')}`;
  };

  const updateCreditsPill = (credits: number): void => {
    if (creditsEl) {
      creditsEl.textContent = String(credits);
      creditsEl.parentElement?.classList.toggle('low', credits <= 10);
    }
  };

  // Instant, free preview of the current parts (before a real nest is run).
  const showPreview = (label: string): void => {
    const parts = currentParts();
    el('svgHost').innerHTML = parts.length
      ? previewSvg(parts)
      : '<div class="placeholder">No parts yet.</div>';
    zoom?.fit();
    exportSvgBtn.disabled = true;
    exportDxfBtn.disabled = true;
    lastResult = null;
    statusEl.textContent = label;
  };

  // Sheet W/H are auto-computed in fit mode, so grey the inputs out.
  const syncSheetInputs = (): void => {
    const disabled = fitEnabled();
    el<HTMLInputElement>('sheetW').disabled = disabled;
    el<HTMLInputElement>('sheetH').disabled = disabled;
  };

  const metricCard = (label: string, value: string, good = false): string =>
    `<div class="card${good ? ' good' : ''}"><div class="k">${label}</div><div class="v">${value}</div></div>`;

  const renderMetrics = (r: NestResult, cm: CutMetrics): void => {
    const m = r.metrics;
    const cutSec = cm.estimatedCutTimeSec || m.estimatedCutTimeSec;
    const mins = Math.floor(cutSec / 60);
    const secs = Math.round(cutSec % 60);
    metricsEl.innerHTML = [
      metricCard(t('app.mSheets'), `${r.sheetsUsed} <small>/ ${t('app.naive')} ${m.baselineSheets}</small>`),
      metricCard(t('app.mUtil'), `${(m.utilization * 100).toFixed(1)}<small>%</small>`),
      metricCard(t('app.mSaved'), `$${m.savedMoney.toFixed(0)}`, m.savedMoney > 0),
      metricCard(t('app.mCutLen'), `${(cm.effectiveCutLength / 1000).toFixed(2)}<small>m</small>`),
      metricCard(t('app.mCommon'), `${(cm.savedLength / 1000).toFixed(2)}<small>m</small>`, cm.savedLength > 0),
      metricCard(t('app.mCutTime'), `${mins}<small>m</small> ${secs}<small>s</small>`),
      metricCard(t('app.mUnplaced'), String(r.unplaced.length), r.unplaced.length === 0),
    ].join('');
  };

  // Draws each placed part from its ORIGINAL vector (exact curves/size) when a
  // source is available; returns undefined so the engine keeps its flattened
  // fallback for sample sets / text / DXF.
  const makePartSvg = (r: NestResult): ((id: string, p: NestResult['placements'][number]) => string | null) | undefined => {
    const src = currentSources();
    if (!src.size) return undefined;
    const worldStroke = Math.max(r.config.sheet.width, r.config.sheet.height) / 400;
    return (partId, placement) => {
      const s = src.get(partId);
      return s ? partSvgFor(s, placement, worldStroke) : null;
    };
  };

  // Pure: draws the layout + metrics for `lastResult`/`lastParts`. Never charges,
  // so it is safe to call from the "Show cut path" toggle at any time.
  const render = (r: NestResult): void => {
    lastResult = r;
    lastPlans = planCutPath(r, lastParts);
    const cm = cutMetrics(lastPlans, currentConfig());
    const partSvg = makePartSvg(r);
    el('svgHost').innerHTML = resultToSVG(r, lastParts, {
      ...(checked('showPath') ? { cutPlans: lastPlans } : {}),
      ...(partSvg ? { partSvg } : {}),
    });
    zoom?.fit();
    renderMetrics(r, cm);
    exportSvgBtn.disabled = false;
    exportDxfBtn.disabled = false;
  };

  const run = (): void => {
    if (busy) return;
    const u = api.cachedUser();
    if (!api.isLoggedIn() || !u) {
      navigate('#/login');
      return;
    }
    const parts = currentParts();
    if (!parts.length) {
      statusEl.textContent = 'No parts to nest.';
      return;
    }
    const instances = instanceCount(parts);
    const cost = nestCost(instances, strategy);
    if (u.credits < cost) {
      statusEl.textContent = t('app.notEnough', { cost, have: u.credits });
      return;
    }
    busy = true;
    runBtn.disabled = true;
    runCtx = { instances, strategy, cost, parts };
    statusEl.textContent = t('app.nesting', { n: instances, s: strategy });
    worker.postMessage({ parts, config: currentConfig() });
  };

  worker.onmessage = async (e: MessageEvent<{ result?: NestResult; error?: string }>) => {
    if (e.data.error) {
      busy = false;
      runBtn.disabled = false;
      runCtx = null;
      statusEl.textContent = `Error: ${e.data.error}`;
      return;
    }
    const r = e.data.result;
    if (!r) {
      busy = false;
      runBtn.disabled = false;
      return;
    }
    // Charge FIRST (the server reprices) — the paid deliverable (layout render
    // + enabled exports) only appears once the charge succeeds, so blocking or
    // failing /api/nest/complete cannot yield a free, exportable nest. `busy`
    // stays true through the await so a second run can't start mid-charge.
    if (runCtx) {
      const ctx = runCtx;
      runCtx = null;
      try {
        const res = await api.completeNest({
          parts: ctx.instances,
          strategy: ctx.strategy,
          sheets: r.sheetsUsed,
          utilPct: Math.min(100, r.metrics.utilization * 100),
        });
        updateCreditsPill(res.credits);
        lastParts = ctx.parts;
      } catch (err) {
        busy = false;
        runBtn.disabled = false;
        updateCostLabel();
        if (err instanceof api.ApiError && err.status === 401) {
          navigate('#/login');
          return;
        }
        statusEl.textContent = err instanceof api.ApiError ? err.message : t('app.chargeFail');
        return; // result intentionally not rendered or exportable
      }
    }
    busy = false;
    runBtn.disabled = false;
    // Crop the sheet to the packed parts for a clean, full layout (auto-size).
    const out = fitEnabled() ? fitToParts(r, lastParts, num('margin')) : r;
    render(out);
    statusEl.textContent =
      `Done in ${r.elapsedMs} ms · ${r.placements.length} placed · ${r.iterations} layouts` +
      (r.unplaced.length ? ` · ${r.unplaced.length} did not fit` : '');
    updateCostLabel();
  };
  worker.onerror = (e) => {
    busy = false;
    runBtn.disabled = false;
    runCtx = null;
    statusEl.textContent = `Worker error: ${e.message}`;
  };

  // --- Import (SVG / DXF) ---
  const isDxf = (text: string, name: string): boolean => {
    if (/\.dxf$/i.test(name)) return true;
    if (/\.svg$/i.test(name) || /<svg[\s>]/i.test(text)) return false;
    return /\bENTITIES\b/.test(text) && /\bSECTION\b/.test(text);
  };
  const loadFile = (text: string, name: string): void => {
    importedText = text;
    importedName = name;
    const scale = num('scale') || 1;
    const result = isDxf(text, name) ? importDxfParts(text, scale) : importSvgParts(text, scale);
    const { parts, warnings } = result;
    if (!parts.length) {
      importInfo.textContent = warnings[0] ?? 'No shapes found.';
      importInfo.classList.add('warn');
      return;
    }
    importedParts = parts;
    sources = result.sources ?? new Map(); // exact geometry for SVG imports
    mode = 'imported';
    importInfo.classList.toggle('warn', warnings.length > 0);
    importInfo.textContent = `Imported ${parts.length} shapes from ${isDxf(text, name) ? 'DXF' : 'SVG'}${
      warnings.length ? ' · ' + warnings[0] : ''
    }`;
    updateCostLabel();
    showPreview(t('app.partsReady'));
  };

  const fileInput = el<HTMLInputElement>('file');
  el('browse').addEventListener('click', () => fileInput.click());
  el('drop').addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id !== 'browse') fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) f.text().then((t) => loadFile(t, f.name));
  });
  const drop = el('drop');
  ['dragenter', 'dragover'].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add('over');
    }),
  );
  ['dragleave', 'drop'].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove('over');
    }),
  );
  drop.addEventListener('drop', (e) => {
    const f = (e as DragEvent).dataTransfer?.files?.[0];
    if (f) f.text().then((t) => loadFile(t, f.name));
  });
  el('scale').addEventListener('change', () => {
    if (mode === 'imported' && importedText) loadFile(importedText, importedName);
  });

  // --- Text -> letters ---
  const makeLetters = async (): Promise<void> => {
    const text = el<HTMLInputElement>('text').value;
    const h = Number(el<HTMLInputElement>('letterH').value) || 80;
    importInfo.classList.remove('warn');
    importInfo.textContent = t('app.building');
    try {
      const parts = await textToParts(text, h);
      if (!parts.length) {
        importInfo.textContent = 'No letters to cut (spaces only?).';
        importInfo.classList.add('warn');
        return;
      }
      importedParts = parts;
      sources = new Map(); // letters use the engine's own rendering
      mode = 'imported';
      importedText = null;
      importedName = '';
      importInfo.textContent = `Generated ${parts.length} letter pieces from “${text.trim()}”`;
      updateCostLabel();
      showPreview(t('app.lettersReady', { n: parts.length }));
    } catch (err) {
      importInfo.textContent = `Could not build letters: ${err instanceof Error ? err.message : String(err)}`;
      importInfo.classList.add('warn');
    }
  };
  el('makeText').addEventListener('click', makeLetters);
  el('text').addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') makeLetters();
  });

  // --- Controls ---
  document.querySelectorAll<HTMLButtonElement>('#strategy button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#strategy button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      strategy = (btn.dataset.val as Strategy) ?? 'fast';
      updateCostLabel();
    });
  });
  el('sampleSet').addEventListener('change', () => {
    mode = 'sample';
    sources = new Map();
    importInfo.classList.remove('warn');
    importInfo.textContent = t('app.usingSample');
    updateCostLabel();
    showPreview(readyLabel());
  });
  el('fitSheet').addEventListener('change', () => {
    syncSheetInputs();
    updateCostLabel();
  });
  el('mirror').addEventListener('change', () => {
    // Re-preview reflected parts; nulling lastResult keeps a later render/export
    // from mixing a fresh mirror state with a result nested under the old one.
    showPreview(readyLabel());
  });
  el('machinePreset').addEventListener('change', () => {
    const v = el<HTMLSelectElement>('machinePreset').value;
    // Beds are given in cm in the label; set the real mm size + spacing here.
    const presets: Record<string, { w: number; h: number; spacing: number }> = {
      laser: { w: 1210, h: 900, spacing: 2 },
      rover: { w: 2400, h: 1200, spacing: 10 },
    };
    const p = presets[v];
    if (p) {
      el<HTMLInputElement>('sheetW').value = String(p.w);
      el<HTMLInputElement>('sheetH').value = String(p.h);
      el<HTMLInputElement>('spacing').value = String(p.spacing);
      el<HTMLInputElement>('fitSheet').checked = false; // use the real bed; overflow to more sheets
    }
    syncSheetInputs();
    updateCostLabel();
    showPreview(readyLabel());
  });
  runBtn.addEventListener('click', run);
  exportSvgBtn.addEventListener('click', () => lastResult && exportSvg(lastResult, lastParts, makePartSvg(lastResult)));
  exportDxfBtn.addEventListener('click', () => lastResult && exportDxf(lastResult, lastParts));
  el('showPath').addEventListener('change', () => {
    if (lastResult) render(lastResult);
  });

  // Nav
  root.querySelector('.js-home')?.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('#/');
  });
  root.querySelector('.js-logout')?.addEventListener('click', () => {
    api.logout();
    navigate('#/');
  });
  wireLangSwitch(root);

  const vq = (sel: string): HTMLElement => viewport.querySelector(sel) as HTMLElement;
  zoom = createZoomPan(viewport, el('svgHost'), {
    in: vq('.js-zoom-in'),
    out: vq('.js-zoom-out'),
    fit: vq('.js-zoom-fit'),
    level: vq('.js-zoom-lvl'),
  });

  updateCostLabel();
  syncSheetInputs();
  showPreview(t('app.previewHint'));

  // Refresh the balance from the server (kicks stale sessions back to login).
  api
    .me()
    .then((fresh) => {
      if (fresh) updateCreditsPill(fresh.credits);
      else navigate('#/login');
    })
    .catch((err) => {
      if (err instanceof api.ApiError && err.status === 401) navigate('#/login');
      // Network failure: keep the cached view usable; charging will surface errors.
    });

  return () => {
    worker.terminate();
    zoom?.destroy();
  };
}
