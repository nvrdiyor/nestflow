import {
  cutMetrics,
  planCutPath,
  resultToSVG,
  ringBounds,
  type Contour,
  type CutMetrics,
  type CutPlan,
  type NestConfig,
  type NestResult,
  type Part,
  type Strategy,
} from '@nestflow/engine';
import { importSvgParts } from '../svgImport';
import { importDxfParts } from '../dxfImport';
import { exportDxf } from '../exporters';
import { appNavMarkup } from '../ui/nav';
import * as api from '../api';
import { nestCost } from '../cost';
import { estimateSheet, fitToParts } from '../autofit';
import { previewSvg } from '../preview';
import { t, wireLangSwitch } from '../i18n';
import type { VectorSource } from '../importCommon';
import { partSvgFor } from '../sourceRender';
import { createZoomPan, type ZoomPan } from '../zoomPan';
import { mirrorFineContours, mirrorParts, mirrorSources } from '../mirror';

type Nav = (hash: string) => void;

/**
 * Work state that must SURVIVE view re-renders (a language switch re-routes and
 * rebuilds the whole view) — otherwise an imported file and a paid nest result
 * would silently vanish. Written on cleanup, restored on the next mount.
 */
interface SavedWork {
  importedParts: Part[];
  importedText: string | null;
  importedName: string;
  importInfo: string;
  sources: Map<string, VectorSource>;
  fineContours: Map<string, Contour>;
  importScale: number;
  importTol: number;
  baseW: number;
  baseH: number;
  lastParts: Part[];
  lastResult: NestResult | null;
  lastPlans: CutPlan[];
  mirrorMode: string;
}
let savedWork: SavedWork | null = null;

/** All rotations are always allowed; the engine always searches at max effort. */
const ROTATIONS = [0, 90, 180, 270];
const STRATEGY: Strategy = 'max';

const toolMarkup = (): string => `
<div class="tool-view"><main class="layout">
  <aside class="panel">
    <section class="group">
      <h2>${t('app.yourParts')}</h2>
      <div id="drop" class="drop">
        <input id="file" type="file" accept=".svg,.dxf,image/svg+xml" hidden />
        <i data-lucide="upload" class="drop-ic"></i>
        <span>${t('app.dropHere')} <button type="button" id="browse" class="link">${t('app.browse')}</button></span>
      </div>
      <div class="row">
        <label class="field"><span>${t('app.realW')} <b class="js-unit">mm</b></span><input id="realW" type="number" min="0.1" step="1" disabled /></label>
        <label class="field"><span>${t('app.realH')} <b class="js-unit">mm</b></span><input id="realH" type="number" min="0.1" step="1" disabled /></label>
      </div>
      <p class="hint">${t('app.sizeHint')}</p>
      <p id="importInfo" class="hint">${t('app.uploadHint')}</p>
    </section>
    <section class="group">
      <h2>${t('app.sheet')} <b class="js-unit" style="text-transform:none">mm</b></h2>
      <div class="row">
        <label class="field"><span>${t('app.machine')}</span>
          <select id="machinePreset">
            <option value="laser" selected>Lazer 1210×900</option>
            <option value="rover">Rover 2400×1200</option>
            <option value="custom">${t('app.custom')}</option>
          </select>
        </label>
        <label class="field" style="flex:0 0 76px"><span>${t('app.unit')}</span>
          <select id="unit">
            <option value="mm" selected>mm</option>
            <option value="cm">sm</option>
          </select>
        </label>
      </div>
      <div class="row" style="margin-top:10px">
        <label class="field"><span>${t('app.width')} <b class="js-unit">mm</b></span><input id="sheetW" type="number" value="1210" min="1" step="1" /></label>
        <label class="field"><span>${t('app.height')} <b class="js-unit">mm</b></span><input id="sheetH" type="number" value="900" min="1" step="1" /></label>
      </div>
      <div class="row">
        <label class="field"><span>${t('app.margin')} <b class="js-unit">mm</b></span><input id="margin" type="number" value="5" min="0" step="1" /></label>
        <label class="field"><span>${t('app.sheetCost')}</span><input id="sheetCost" type="number" value="45" min="0" step="1" /></label>
      </div>
      <label class="check" style="margin-top:10px"><input id="fitSheet" type="checkbox" /> <span>${t('app.fitSheet')}</span></label>
    </section>
    <section class="group">
      <h2>${t('app.cutting')}</h2>
      <div class="row">
        <label class="field"><span>${t('app.spacing')} <b class="js-unit">mm</b></span><input id="spacing" type="number" value="2" min="0" step="0.5" /></label>
        <label class="field"><span>${t('app.kerf')} <b>mm</b></span><input id="kerf" type="number" value="0.2" min="0" step="0.1" /></label>
      </div>
      <label class="check"><input id="holeFilling" type="checkbox" /> <span>${t('app.fillHoles')}</span></label>
      <label class="check" style="margin-top:10px"><input id="allowRot" type="checkbox" checked /> <span>${t('app.allowRot')}</span></label>
      <label class="field" style="margin-top:10px"><span>${t('app.mirror')}</span>
        <select id="mirrorMode">
          <option value="off" selected>${t('app.mirrorOff')}</option>
          <option value="auto">${t('app.mirrorAuto')}</option>
          <option value="all">${t('app.mirrorAll')}</option>
        </select>
      </label>
      <label class="check" style="margin-top:10px"><input id="showPath" type="checkbox" /> <span>${t('app.showPath')}</span></label>
    </section>
    <button id="run" class="primary" disabled>${t('app.nestLayout')}</button>
    <p id="status" class="status"></p>
    <section class="group">
      <h2>${t('app.export')}</h2>
      <div class="exports">
        <button id="exportDxf" class="secondary" disabled>${t('app.downloadDxf')}</button>
      </div>
    </section>
  </aside>
  <section class="stage">
    <div class="metrics" id="metrics"></div>
    <div class="viewport" id="viewport">
      <div class="svg-host" id="svgHost"></div>
      <div class="progress-veil" id="progressVeil" hidden>
        <div class="pv-num"><span id="progressPct">0</span><small>%</small></div>
        <div class="pv-bar"><div class="pv-fill" id="progressFill"></div></div>
        <div class="pv-label">${t('app.optimizing')}</div>
      </div>
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

  let worker: Worker; // recreated by the hang watchdog if a nest never returns
  const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
  const num = (id: string): number => Number(el<HTMLInputElement>(id).value) || 0;
  const checked = (id: string): boolean => el<HTMLInputElement>(id).checked;

  let importedParts: Part[] = savedWork?.importedParts ?? [];
  let importedText: string | null = savedWork?.importedText ?? null;
  let importedName = savedWork?.importedName ?? '';
  let lastParts: Part[] = savedWork?.lastParts ?? [];
  let lastResult: NestResult | null = savedWork?.lastResult ?? null;
  let lastPlans: CutPlan[] = savedWork?.lastPlans ?? [];
  let sources = savedWork?.sources ?? new Map<string, VectorSource>();
  let fineContours = savedWork?.fineContours ?? new Map<string, Contour>();
  let importScale = savedWork?.importScale ?? 1; // mm per file unit, set via real-size fields
  let importTol = savedWork?.importTol ?? 0; // nesting-polygon deviation, compensated in spacing
  let baseW = savedWork?.baseW ?? 0; // imported bbox at scale 1, mm
  let baseH = savedWork?.baseH ?? 0;
  let zoom: ZoomPan | null = null;
  let busy = false;
  let watchdog = 0;
  let unit: 'mm' | 'cm' = 'mm';
  let runCtx: { instances: number; strategy: Strategy; cost: number; parts: Part[] } | null = null;

  const statusEl = el('status');
  const statusMsg = (text: string, isError = false): void => {
    statusEl.textContent = text;
    statusEl.classList.toggle('error', isError);
  };
  const runBtn = el<HTMLButtonElement>('run');
  const viewport = el('viewport');
  const metricsEl = el('metrics');
  const importInfo = el('importInfo');
  const exportDxfBtn = el<HTMLButtonElement>('exportDxf');
  const creditsEl = root.querySelector<HTMLElement>('.js-credits');

  type MirrorMode = 'off' | 'auto' | 'all';
  const mirrorMode = (): MirrorMode => (el<HTMLSelectElement>('mirrorMode').value as MirrorMode) ?? 'off';
  // 'all' pre-mirrors the geometry (back-side cutting); 'auto' merely lets the
  // OPTIMIZER flip individual parts when that packs tighter.
  const mirrorOn = (): boolean => mirrorMode() === 'all';
  // Keeps the "Mirrored" reminder in the status line while mirror stays on.
  const readyLabel = (): string => (mirrorOn() ? t('app.mirrorOn') : t('app.ready'));

  const currentParts = (): Part[] => (mirrorOn() ? mirrorParts(importedParts) : importedParts);

  // Exact SVG geometry, reflected to match the mirrored parts when mirror is on.
  const currentSources = (): Map<string, VectorSource> => (mirrorOn() ? mirrorSources(sources) : sources);
  const currentFine = (): Map<string, Contour> => (mirrorOn() ? mirrorFineContours(fineContours) : fineContours);

  const instanceCount = (parts: Part[]): number => parts.reduce((s, p) => s + (p.quantity ?? 1), 0);

  const fitEnabled = (): boolean => checked('fitSheet');

  /** mm per displayed unit — every length input is shown in `unit`. */
  const unitFactor = (): number => (unit === 'cm' ? 10 : 1);
  const toMm = (id: string): number => num(id) * unitFactor();
  const setLen = (id: string, mm: number): void => {
    el<HTMLInputElement>(id).value = String(+(mm / unitFactor()).toFixed(2));
  };

  const currentConfig = (): NestConfig => {
    // In fit-to-parts mode the packer runs on a generous auto-sized sheet so it
    // clusters everything on one sheet; the result is then cropped to the pack.
    const sheet = fitEnabled()
      ? { ...estimateSheet(currentParts()), margin: toMm('margin'), cost: num('sheetCost') }
      : { width: toMm('sheetW'), height: toMm('sheetH'), margin: toMm('margin'), cost: num('sheetCost') };
    return {
      sheet,
      units: 'mm',
      rotations: checked('allowRot') ? ROTATIONS : [0],
      allowMirror: mirrorMode() === 'auto', // per-part, only where it helps
      // The nesting polygon may deviate up to importTol from the true curve —
      // widen the spacing by that amount so real geometry keeps the asked gap.
      spacing: toMm('spacing') + importTol,
      kerf: num('kerf'), // kerf is always mm — it is a sub-millimetre quantity
      holeFilling: checked('holeFilling'),
      strategy: STRATEGY,
      seed: (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0, // fresh search every run
      timeLimitMs: searchBudgetMs(),
      machine: { cutSpeed: 25, travelSpeed: 200, hourlyRate: 75, pierceTime: 0.4 },
    };
  };

  const updateCostLabel = (): void => {
    const n = instanceCount(currentParts());
    runBtn.textContent = n ? `${t('app.nestLayout')} · ${nestCost(n, STRATEGY)} ${t('nav.credits')}` : t('app.nestLayout');
    runBtn.disabled = busy || n === 0;
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
      : `<div class="empty-state"><div class="es-ic">⬆</div><p>${t('app.emptyState')}</p></div>`;
    zoom?.fit();
    exportDxfBtn.disabled = true;
    lastResult = null;
    statusEl.textContent = parts.length ? label : '';
    updateCostLabel();
  };

  // --- 0→100% progress veil over the viewport while the engine searches ---
  // The engine reports fraction = elapsed/timeLimit, but only when the search
  // improves — so a local timer drives a smooth count on the same time basis,
  // and engine reports can only push it FORWARD, never back.
  // Bigger jobs get a bigger search budget: heavy real-size letter sets spend
  // seconds just warming the NFP cache, and an 8s cap left "1 layouts" tried.
  const searchBudgetMs = (): number =>
    Math.min(40_000, 8000 + Math.max(0, instanceCount(currentParts()) - 8) * 700);
  let SEARCH_MS = 8000;
  const veil = el('progressVeil');
  const veilPct = el('progressPct');
  const veilFill = el('progressFill');
  let shownPct = 0;
  let veilTimer = 0;
  let veilStart = 0;
  const paint = (): void => {
    veilPct.textContent = String(shownPct);
    veilFill.style.width = `${shownPct}%`;
  };
  const setProgress = (pct: number): void => {
    shownPct = Math.max(shownPct, Math.min(99, Math.round(pct)));
    paint();
  };
  const showVeil = (): void => {
    SEARCH_MS = searchBudgetMs();
    shownPct = 0;
    veilStart = Date.now();
    paint();
    veil.hidden = false;
    clearInterval(veilTimer);
    veilTimer = window.setInterval(() => {
      setProgress(((Date.now() - veilStart) / SEARCH_MS) * 100);
    }, 120);
  };
  const hideVeil = (done: boolean): void => {
    clearInterval(veilTimer);
    if (done) {
      shownPct = 100;
      paint();
      setTimeout(() => {
        veil.hidden = true;
      }, 350);
    } else {
      veil.hidden = true;
    }
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
      sheetLabel: (n, util) => t('app.sheetLabel', { n, util }),
    });
    zoom?.fit();
    renderMetrics(r, cm);
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
      statusMsg(t('app.uploadFirst'), true);
      return;
    }
    const instances = instanceCount(parts);
    const cost = nestCost(instances, STRATEGY);
    if (u.credits < cost) {
      statusMsg(t('app.notEnough', { cost, have: u.credits }), true);
      return;
    }
    busy = true;
    runBtn.disabled = true;
    runCtx = { instances, strategy: STRATEGY, cost, parts };
    statusMsg(t('app.nesting', { n: instances, s: STRATEGY }));
    showVeil();
    worker.postMessage({ parts, config: currentConfig() });
    armWatchdog();
  };

  async function onWorkerMessage(e: MessageEvent<{ result?: NestResult; error?: string; progress?: number; overlaps?: number }>): Promise<void> {
    if (e.data.progress !== undefined) {
      armWatchdog(); // the engine is alive — keep waiting
      setProgress(e.data.progress);
      return;
    }
    disarmWatchdog();
    if (e.data.error) {
      busy = false;
      runBtn.disabled = false;
      runCtx = null;
      hideVeil(false);
      statusMsg(`Error: ${e.data.error}`, true);
      return;
    }
    const r = e.data.result;
    if (!r) {
      busy = false;
      runBtn.disabled = false;
      hideVeil(false);
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
        hideVeil(false);
        updateCostLabel();
        if (err instanceof api.ApiError && err.status === 401) {
          navigate('#/login');
          return;
        }
        statusMsg(err instanceof api.ApiError ? err.message : t('app.chargeFail'), true);
        return; // result intentionally not rendered or exportable
      }
    }
    busy = false;
    runBtn.disabled = false;
    // Crop the sheet to the packed parts for a clean, full layout (auto-size).
    const out = fitEnabled() ? fitToParts(r, lastParts, toMm('margin')) : r;
    render(out);
    hideVeil(true);
    const overlaps = e.data.overlaps ?? 0;
    if (overlaps > 0) {
      statusMsg(t('app.overlapWarn', { n: overlaps }), true);
    } else {
      statusMsg(
        `Done in ${r.elapsedMs} ms · ${r.placements.length} placed · ${r.iterations} layouts` +
          (r.unplaced.length ? ` · ${r.unplaced.length} did not fit` : ''),
      );
    }
    updateCostLabel();
  }
  function onWorkerError(e: ErrorEvent): void {
    disarmWatchdog();
    busy = false;
    runBtn.disabled = false;
    runCtx = null;
    hideVeil(false);
    statusMsg(`Worker error: ${e.message}`, true);
  }
  function spawnWorker(): void {
    worker = new Worker(new URL('../nest.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = onWorkerMessage;
    worker.onerror = onWorkerError;
  }
  spawnWorker();

  // If the engine goes silent far beyond its 8s budget, the job is stuck on
  // pathological geometry — kill the worker instead of hanging at 99% forever.
  // No credits are lost: charging only ever happens after a result arrives.
  const WATCHDOG_MS = 120_000;
  function armWatchdog(): void {
    clearTimeout(watchdog);
    watchdog = window.setTimeout(() => {
      worker.terminate();
      spawnWorker();
      busy = false;
      runCtx = null;
      hideVeil(false);
      updateCostLabel();
      statusMsg(t('app.tooComplex'), true);
    }, WATCHDOG_MS);
  }
  function disarmWatchdog(): void {
    clearTimeout(watchdog);
  }

  // --- Import (SVG / DXF) ---
  const isDxf = (text: string, name: string): boolean => {
    if (/\.dxf$/i.test(name)) return true;
    if (/\.svg$/i.test(name) || /<svg[\s>]/i.test(text)) return false;
    return /\bENTITIES\b/.test(text) && /\bSECTION\b/.test(text);
  };
  const loadFile = (text: string, name: string): void => {
    importedText = text;
    importedName = name;
    const result = isDxf(text, name) ? importDxfParts(text, importScale) : importSvgParts(text, importScale);
    const { parts, warnings } = result;
    if (!parts.length) {
      importInfo.textContent = warnings[0] ?? 'No shapes found.';
      importInfo.classList.add('warn');
      return;
    }
    importedParts = parts;
    sources = result.sources ?? new Map(); // exact geometry (SVG elements / DXF fine paths)
    fineContours = result.fineContours ?? new Map();
    importTol = Math.min(2, result.simplifyTolMm ?? 0);
    importInfo.classList.toggle('warn', warnings.length > 0);
    // Overall size of the import, so a wrong-unit file is obvious at a glance.
    let bMinX = Infinity;
    let bMinY = Infinity;
    let bMaxX = -Infinity;
    let bMaxY = -Infinity;
    for (const p of parts) {
      const b = ringBounds(p.contour.outer);
      if (b.minX < bMinX) bMinX = b.minX;
      if (b.minY < bMinY) bMinY = b.minY;
      if (b.maxX > bMaxX) bMaxX = b.maxX;
      if (b.maxY > bMaxY) bMaxY = b.maxY;
    }
    const impW = Number.isFinite(bMinX) ? bMaxX - bMinX : 0;
    const impH = Number.isFinite(bMinX) ? bMaxY - bMinY : 0;
    if (impW > 0) {
      baseW = impW / importScale;
      baseH = impH / importScale;
      const wEl = el<HTMLInputElement>('realW');
      const hEl = el<HTMLInputElement>('realH');
      wEl.disabled = false;
      hEl.disabled = false;
      setLen('realW', impW);
      setLen('realH', impH);
    }
    const sizeStr = impW > 0 ? ` · ${Math.round(impW)}×${Math.round(impH)} mm` : '';
    importInfo.textContent =
      t('app.importedShapes', { n: instanceCount(parts), fmt: isDxf(text, name) ? 'DXF' : 'SVG' }) +
      sizeStr +
      (warnings.length ? ' · ' + warnings[0] : '');
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
  // Typing the REAL width or height rescales the whole import proportionally —
  // fixes files exported without unit info (common from CorelDRAW).
  const applyRealSize = (dim: 'w' | 'h'): void => {
    if (!importedText || !(baseW > 0)) return;
    const wanted = toMm(dim === 'w' ? 'realW' : 'realH');
    const base = dim === 'w' ? baseW : baseH;
    if (!(wanted > 0) || !(base > 0)) return;
    importScale = wanted / base;
    loadFile(importedText, importedName);
  };
  el('realW').addEventListener('change', () => applyRealSize('w'));
  el('realH').addEventListener('change', () => applyRealSize('h'));

  // --- Controls ---
  el('fitSheet').addEventListener('change', () => {
    syncSheetInputs();
    updateCostLabel();
  });
  el('mirrorMode').addEventListener('change', () => {
    // Re-preview; nulling lastResult keeps a later render/export from mixing a
    // fresh mirror state with a result nested under the old one.
    showPreview(readyLabel());
  });
  // mm ↔ sm: convert every length input in place and retag the labels.
  el('unit').addEventListener('change', () => {
    const next = el<HTMLSelectElement>('unit').value === 'cm' ? 'cm' : 'mm';
    if (next === unit) return;
    const ids = ['sheetW', 'sheetH', 'margin', 'spacing', 'realW', 'realH'].filter((id) => num(id) > 0);
    const mmValues = ids.map((id) => toMm(id));
    unit = next;
    ids.forEach((id, i) => setLen(id, mmValues[i]!));
    root.querySelectorAll('.js-unit').forEach((n) => {
      n.textContent = unit === 'cm' ? 'sm' : 'mm';
    });
    // Preset labels follow the unit too (1210×900 mm ↔ 121×90 sm).
    const presetSel = el<HTMLSelectElement>('machinePreset');
    for (const opt of Array.from(presetSel.options)) {
      if (opt.value === 'laser') opt.textContent = unit === 'cm' ? 'Lazer 121×90' : 'Lazer 1210×900';
      if (opt.value === 'rover') opt.textContent = unit === 'cm' ? 'Rover 240×120' : 'Rover 2400×1200';
    }
  });
  el('machinePreset').addEventListener('change', () => {
    const v = el<HTMLSelectElement>('machinePreset').value;
    // Bed sizes in mm; written into the inputs in the currently selected unit.
    const presets: Record<string, { w: number; h: number; spacing: number }> = {
      laser: { w: 1210, h: 900, spacing: 2 },
      rover: { w: 2400, h: 1200, spacing: 10 },
    };
    const p = presets[v];
    if (p) {
      setLen('sheetW', p.w);
      setLen('sheetH', p.h);
      setLen('spacing', p.spacing);
      el<HTMLInputElement>('fitSheet').checked = false; // use the real bed; overflow to more sheets
    }
    syncSheetInputs();
    updateCostLabel();
    if (currentParts().length) showPreview(readyLabel());
  });
  runBtn.addEventListener('click', run);
  exportDxfBtn.addEventListener('click', () => lastResult && exportDxf(lastResult, lastParts, currentFine()));
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

  // Restore work that survived a re-render (e.g. a language switch): the mirror
  // state must be restored BEFORE rendering so a mirrored result is redrawn with
  // mirrored sources, and the paid result reappears instead of a blank preview.
  if (savedWork) {
    el<HTMLSelectElement>('mirrorMode').value = savedWork.mirrorMode || 'off';
    if (savedWork.importInfo) importInfo.textContent = savedWork.importInfo;
    if (savedWork.baseW > 0) {
      el<HTMLInputElement>('realW').disabled = false;
      el<HTMLInputElement>('realH').disabled = false;
      setLen('realW', savedWork.baseW * savedWork.importScale);
      setLen('realH', savedWork.baseH * savedWork.importScale);
    }
  }
  updateCostLabel();
  syncSheetInputs();
  if (lastResult) {
    render(lastResult);
    statusEl.textContent = readyLabel();
  } else {
    showPreview(readyLabel());
  }
  savedWork = null;

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
    disarmWatchdog();
    worker.terminate();
    zoom?.destroy();
    clearInterval(veilTimer);
    savedWork = {
      importedParts,
      importedText,
      importedName,
      importInfo: importInfo.textContent ?? '',
      sources,
      fineContours,
      importScale,
      importTol,
      baseW,
      baseH,
      lastParts,
      lastResult,
      lastPlans,
      mirrorMode: mirrorMode(),
    };
  };
}
