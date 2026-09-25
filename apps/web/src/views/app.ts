import {
  contourArea,
  cutMetrics,
  planCutPath,
  remnantFreeFraction,
  remnantFromSheet,
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
import { lbrnToSvg } from '../lbrnImport';
import { exportDxf } from '../exporters';
import { openReport } from '../report';
import { attachEditor, type Editor } from '../editor';
import * as store from '../store';
import * as job from '../job';
import { createPartsPanel } from '../partsPanel';
import { appNavMarkup, pillMarkup } from '../ui/nav';
import { openPlans } from '../ui/plans';
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
  files: job.LoadedFile[];
  activeFile: number;
  overrides: Array<[string, job.PartOverride]>;
  lastParts: Part[];
  lastResult: NestResult | null;
  lastPlans: CutPlan[];
  mirrorMode: string;
  runId: string | null;
  remnantId: string;
  resultRemnantId: string | null;
  resultFit: boolean;
  resultPaid: boolean;
  resultInstances: number;
}
let savedWork: SavedWork | null = null;

/** Everything the upload box takes; the binary formats are converted on the server. */
const ACCEPT = '.svg,.dxf,.pdf,.ai,.eps,.ps,.cdr,.dwg,.lbrn,.lbrn2,image/svg+xml,application/pdf';
const SERVER_FORMATS = new Set(['pdf', 'ai', 'eps', 'ps', 'cdr', 'dwg']);
const MAX_UPLOAD = 60 * 1024 * 1024;
const extOf = (name: string): string => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();

/** The engine always searches at max effort; the time budget is the user's lever. */
const STRATEGY: Strategy = 'max';

const toolMarkup = (): string => `
<div class="tool-view"><main class="layout">
  <aside class="panel">
    <section class="group">
      <h2>${t('app.yourParts')}</h2>
      <div id="drop" class="drop">
        <input id="file" type="file" accept="${ACCEPT}" multiple hidden />
        <input id="fileAdd" type="file" accept="${ACCEPT}" multiple hidden />
        <i data-lucide="upload" class="drop-ic"></i>
        <span>${t('app.dropHere')} <button type="button" id="browse" class="link">${t('app.browse')}</button></span>
      </div>
      <div class="row">
        <label class="field"><span>${t('app.realW')} <b class="js-unit">mm</b></span><input id="realW" type="number" min="0.1" step="1" disabled /></label>
        <label class="field"><span>${t('app.realH')} <b class="js-unit">mm</b></span><input id="realH" type="number" min="0.1" step="1" disabled /></label>
      </div>
      <p class="hint">${t('app.sizeHint')}</p>
      <p id="importInfo" class="hint">${t('app.uploadHint')}</p>
      <div id="jobPanel" class="job-panel" hidden></div>
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
      <div class="row">
        <label class="field"><span>${t('app.maxSheets')}</span><input id="maxSheets" type="number" min="1" step="1" placeholder="∞" /></label>
        <label class="field"><span>${t('app.quality')}</span>
          <select id="quality">
            <option value="fast">${t('q.fast')}</option>
            <option value="auto" selected>${t('q.auto')}</option>
            <option value="max">${t('q.max')}</option>
          </select>
        </label>
      </div>
      <label class="check" style="margin-top:10px"><input id="fitSheet" type="checkbox" /> <span>${t('app.fitSheet')}</span></label>
      <div class="rem-row">
        <label class="field"><span>${t('rem.label')}</span>
          <select id="remnantSel"><option value="">${t('rem.none')}</option></select>
        </label>
        <button type="button" id="remnantDel" class="icon-btn" title="${t('rem.delete')}" aria-label="${t('rem.delete')}" hidden>✕</button>
      </div>
      <div id="remnantThumb" class="rem-thumb" hidden></div>
    </section>
    <section class="group">
      <h2>${t('app.cutting')}</h2>
      <div class="row">
        <label class="field"><span>${t('app.spacing')} <b class="js-unit">mm</b></span><input id="spacing" type="number" value="2" min="0" step="0.5" /></label>
        <label class="field"><span>${t('app.kerf')} <b>mm</b></span><input id="kerf" type="number" value="0.2" min="0" step="0.1" /></label>
      </div>
      <label class="check"><input id="holeFilling" type="checkbox" /> <span>${t('app.fillHoles')}</span></label>
      <label class="field" style="margin-top:10px"><span>${t('app.rotation')}</span>
        <select id="rotStep">
          <option value="0">${t('rot.0')}</option>
          <option value="180">0° / 180°</option>
          <option value="90" selected>${t('rot.90')}</option>
          <option value="45">${t('rot.45')}</option>
          <option value="15">${t('rot.15')}</option>
        </select>
      </label>
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
        <button id="exportPdf" class="secondary" disabled>${t('app.downloadPdf')}</button>
      </div>
      <label class="field" style="margin-top:10px"><span>${t('exp.layers')}</span>
        <select id="dxfLayers">
          <option value="split">${t('exp.layersSplit')}</option>
          <option value="source">${t('exp.layersSource')}</option>
          <option value="single">${t('exp.layersSingle')}</option>
        </select>
      </label>
      <label class="check" style="margin-top:8px"><input id="dxfBlocks" type="checkbox" /> <span>${t('exp.blocks')}</span></label>
      <button id="saveRemnant" class="secondary rem-save" disabled>${t('rem.save')}</button>
    </section>
    <details class="group hist" id="histBox">
      <summary><h2>${t('hist.title')} <span id="histCount"></span></h2></summary>
      <div id="histList" class="hist-list"></div>
    </details>
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
        <span class="zc-sep"></span>
        <button class="js-edit" title="${t('app.edit')}" aria-label="${t('app.edit')}" disabled><i data-lucide="move"></i></button>
      </div>
      <div class="edit-bar" id="editBar" hidden>
        <span class="eb-sel" id="ebSel"></span>
        <button type="button" data-rot="-90" title="${t('edit.rotL')}">↺ 90°</button>
        <button type="button" data-rot="90" title="${t('edit.rotR')}">↻ 90°</button>
        <span class="eb-ang"><input id="ebAngle" type="number" value="15" step="1" min="-359" max="359" aria-label="${t('edit.angle')}" />°<button type="button" id="ebRotate" title="${t('edit.rotBy')}">↻</button></span>
        <button type="button" id="ebDelete" title="${t('edit.delete')}">${t('edit.deleteShort')}</button>
        <button type="button" id="ebUndo" title="${t('edit.undo')}" disabled>↶ ${t('edit.undoShort')}</button>
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

  let workers: Worker[] = []; // parallel search lanes, recreated by the hang watchdog
  const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
  const num = (id: string): number => Number(el<HTMLInputElement>(id).value) || 0;
  const checked = (id: string): boolean => el<HTMLInputElement>(id).checked;

  // The job: its drawings, the one the real-size fields resize, per-part choices.
  let files: job.LoadedFile[] = savedWork?.files ?? [];
  let activeFile = savedWork?.activeFile ?? 0;
  const overrides = new Map<string, job.PartOverride>(savedWork?.overrides ?? []);
  // Derived from the job (rebuildJobData): what is nested, drawn and exported.
  let importedParts: Part[] = [];
  let importedName = '';
  let sources = new Map<string, VectorSource>();
  let fineContours = new Map<string, Contour>();
  let partLayers = new Map<string, string>();
  function rebuildJobData(): void {
    importedParts = job.jobParts(files, overrides);
    sources = job.mergedSources(files);
    fineContours = job.mergedFine(files);
    partLayers = job.mergedLayers(files);
    importedName = files.map((x) => x.name).join(' + ');
  }
  rebuildJobData();
  let lastParts: Part[] = savedWork?.lastParts ?? [];
  let lastResult: NestResult | null = savedWork?.lastResult ?? null;
  let lastPlans: CutPlan[] = savedWork?.lastPlans ?? [];
  // Hand edits of the result on screen, newest last (Ctrl+Z).
  const undoStack: NestResult[] = [];
  let zoom: ZoomPan | null = null;
  let busy = false;
  let watchdog = 0;
  let unit: 'mm' | 'cm' = 'mm';
  let runCtx: { instances: number; strategy: Strategy; cost: number; parts: Part[]; remnantId: string | null } | null = null;
  // History id of the job on screen (hand edits update that entry).
  let runId: string | null = savedWork?.runId ?? null;
  let remnantList: store.RemnantEntry[] = [];
  // The remnant the on-screen result was nested on, and whether it is a fit-to-parts crop.
  let resultRemnantId: string | null = savedWork?.resultRemnantId ?? null;
  let resultFit = savedWork?.resultFit ?? false;
  // "Pay to download" mode: the on-screen result is free until it is exported.
  let chargeOn: 'nest' | 'export' = 'nest';
  let resultPaid = savedWork?.resultPaid ?? true;
  let resultInstances = savedWork?.resultInstances ?? 0;
  const esc = (s: string): string =>
    s.replace(/[&<>"']/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'));

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
  const exportPdfBtn = el<HTMLButtonElement>('exportPdf');
  const editBtn = root.querySelector<HTMLButtonElement>('.js-edit')!;
  const saveRemnantBtn = el<HTMLButtonElement>('saveRemnant');
  const remnantSel = el<HTMLSelectElement>('remnantSel');
  let editor: Editor;

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

  // What actually gets NESTED: the true (fine) contour of every part. The light
  // import polygon is a preview only — nesting it let parts drift from their
  // drawn size and let true outlines creep into each other.
  const nestParts = (): Part[] => {
    const fine = currentFine();
    return currentParts().map((p) => {
      const c = fine.get(p.id);
      return c ? { ...p, contour: c } : p;
    });
  };

  /** Can the cached user run a job of `letters` without buying a plan? */
  const canAfford = (u: api.ApiUser, letters: number): boolean =>
    u.vip === true || u.credits >= nestCost(letters) || (u.freeLeft ?? 0) > 0;

  const instanceCount = (parts: Part[]): number => parts.reduce((s, p) => s + (p.quantity ?? 1), 0);

  const currentRemnant = (): store.RemnantEntry | null =>
    remnantList.find((r) => r.id === remnantSel.value) ?? null;
  // A remnant has its own fixed size — fit-to-parts does not apply there.
  const fitEnabled = (): boolean => checked('fitSheet') && !currentRemnant();

  /** mm per displayed unit — every length input is shown in `unit`. */
  const unitFactor = (): number => (unit === 'cm' ? 10 : 1);
  const toMm = (id: string): number => num(id) * unitFactor();
  const setLen = (id: string, mm: number): void => {
    el<HTMLInputElement>(id).value = String(+(mm / unitFactor()).toFixed(2));
  };

  const currentConfig = (): NestConfig => {
    // In fit-to-parts mode the packer runs on a generous auto-sized sheet so it
    // clusters everything on one sheet; the result is then cropped to the pack.
    const rem = currentRemnant();
    const sheet = rem
      ? { width: rem.width, height: rem.height, margin: rem.margin, cost: num('sheetCost') }
      : fitEnabled()
        ? { ...estimateSheet(currentParts()), margin: toMm('margin'), cost: num('sheetCost') }
        : { width: toMm('sheetW'), height: toMm('sheetH'), margin: toMm('margin'), cost: num('sheetCost') };
    const maxSheets = Math.round(num('maxSheets'));
    return {
      sheet: maxSheets > 0 && !fitEnabled() ? { ...sheet, quantity: maxSheets } : sheet,
      ...(rem ? { remnants: [{ blocked: rem.blocked, label: rem.name }] } : {}),
      units: 'mm',
      rotations: job.rotationsFor(el<HTMLSelectElement>('rotStep').value),
      allowMirror: mirrorMode() === 'auto', // per-part, only where it helps
      // Parts are nested on their true contours, so the asked gap is exact.
      spacing: toMm('spacing'),
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
    const u = api.cachedUser();
    let suffix = '';
    if (n && u && !u.vip) {
      if (u.credits >= nestCost(n)) suffix = ` · ${nestCost(n)} ${t('nav.credits')}`;
      else if ((u.freeLeft ?? 0) > 0) suffix = ` · ${t('plan.runFree', { n: u.freeLeft ?? 0 })}`;
    }
    runBtn.textContent = t('app.nestLayout') + (chargeOn === 'export' ? (n ? ` · ${t('plan.nestFree')}` : '') : suffix);
    runBtn.disabled = busy || n === 0;
    updateExportLabels();
  };

  // In "pay to download" mode the export buttons carry the price until paid.
  const updateExportLabels = (): void => {
    let suffix = '';
    const u = api.cachedUser();
    if (lastResult && !resultPaid && u && !u.vip) {
      const cost = nestCost(resultInstances || lastResult.placements.length);
      if (u.credits >= cost) suffix = ` · ${cost} ${t('nav.credits')}`;
      else if ((u.freeLeft ?? 0) > 0) suffix = ` · ${t('plan.runFree', { n: u.freeLeft ?? 0 })}`;
    }
    exportDxfBtn.textContent = t('app.downloadDxf') + suffix;
    exportPdfBtn.textContent = t('app.downloadPdf') + suffix;
  };

  /** Charges the on-screen result once (pay-to-download mode); true when it may be exported. */
  const ensurePaid = async (): Promise<boolean> => {
    if (resultPaid || !lastResult) return !!lastResult;
    const u = api.cachedUser();
    if (!api.isLoggedIn() || !u) {
      navigate('#/login');
      return false;
    }
    const r = lastResult;
    const instances = resultInstances || r.placements.length;
    if (!canAfford(u, instances)) {
      const cost = nestCost(instances);
      const reason = u.credits > 0 ? t('plan.notEnough', { cost, have: u.credits }) : t('plan.outOfFree');
      statusMsg(reason, true);
      openPlans(u, reason);
      return false;
    }
    try {
      await api.completeNest({
        parts: instances,
        strategy: STRATEGY,
        sheets: r.sheetsUsed,
        utilPct: Math.min(100, r.metrics.utilization * 100),
      });
    } catch (err) {
      if (err instanceof api.ApiError && err.status === 401) {
        navigate('#/login');
        return false;
      }
      if (err instanceof api.ApiError && err.status === 402) {
        const reason = t('plan.outOfFree');
        statusMsg(reason, true);
        openPlans(api.cachedUser(), reason);
        return false;
      }
      statusMsg(t('app.exportChargeFail'), true);
      return false;
    }
    resultPaid = true;
    const fresh = api.cachedUser();
    if (fresh) refreshPill(fresh);
    updateCostLabel();
    if (lastResult) saveRun(lastResult);
    return true;
  };

  // The nav plan pill: redrawn whenever the account changes; opens the plans dialog.
  const refreshPill = (user: api.ApiUser): void => {
    const old = root.querySelector<HTMLElement>('.credits-pill');
    if (!old) return;
    const holder = document.createElement('span');
    holder.innerHTML = pillMarkup(user);
    const pill = holder.firstElementChild as HTMLElement;
    old.replaceWith(pill);
    pill.addEventListener('click', () => openPlans(api.cachedUser()));
  };
  root.querySelector('.js-plans')?.addEventListener('click', () => openPlans(api.cachedUser()));

  // Instant, free preview of the current parts (before a real nest is run).
  const showPreview = (label: string): void => {
    const parts = currentParts();
    el('svgHost').innerHTML = parts.length
      ? previewSvg(parts)
      : `<div class="empty-state"><div class="es-ic">⬆</div><p>${t('app.emptyState')}</p></div>`;
    zoom?.fit();
    exportDxfBtn.disabled = true;
    exportPdfBtn.disabled = true;
    editBtn.disabled = true;
    saveRemnantBtn.disabled = true;
    lastResult = null;
    runId = null;
    undoStack.length = 0;
    statusEl.textContent = parts.length ? label : '';
    updateCostLabel();
  };

  // --- 0→100% progress veil over the viewport while the engine searches ---
  // The engine reports fraction = elapsed/timeLimit, but only when the search
  // improves — so a local timer drives a smooth count on the same time basis,
  // and engine reports can only push it FORWARD, never back.
  // Bigger jobs get a bigger search budget: heavy real-size letter sets spend
  // seconds just warming the NFP cache, and an 8s cap left "1 layouts" tried.
  // The user prioritises pack quality over wall-clock: big jobs get up to 90s
  // of search (progress stays live via per-part heartbeats, so waiting is safe).
  const searchBudgetMs = (): number => {
    const auto = Math.min(90_000, 8000 + Math.max(0, instanceCount(currentParts()) - 8) * 900);
    const q = el<HTMLSelectElement>('quality').value;
    return q === 'fast' ? Math.min(auto, 12_000) : q === 'max' ? Math.min(240_000, Math.round(auto * 2.5)) : auto;
  };
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
    const rem = currentRemnant();
    const disabled = fitEnabled() || rem !== null;
    el<HTMLInputElement>('sheetW').disabled = disabled;
    el<HTMLInputElement>('sheetH').disabled = disabled;
    el<HTMLInputElement>('margin').disabled = rem !== null;
    el<HTMLInputElement>('fitSheet').disabled = rem !== null;
    el('remnantDel').hidden = rem === null;
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
  const render = (r: NestResult, keepView = false): void => {
    lastResult = r;
    lastPlans = planCutPath(r, lastParts);
    const cm = cutMetrics(lastPlans, currentConfig());
    const partSvg = makePartSvg(r);
    el('svgHost').innerHTML = resultToSVG(r, lastParts, {
      ...(checked('showPath') ? { cutPlans: lastPlans } : {}),
      ...(partSvg ? { partSvg } : {}),
      sheetLabel: (n, util) => t('app.sheetLabel', { n, util }),
      tagParts: true,
    });
    if (keepView) zoom?.keep();
    else zoom?.fit();
    renderMetrics(r, cm);
    exportDxfBtn.disabled = false;
    exportPdfBtn.disabled = false;
    editBtn.disabled = false;
    saveRemnantBtn.disabled = resultFit || r.placements.length === 0;
    updateExportLabels();
  };

  // Parallel search lanes: every lane runs the same job from different seed
  // layouts on its own CPU core and the lowest-score layout wins. One core is
  // left free for the UI.
  const LANES = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
  type WorkerMsg = {
    result?: NestResult;
    preview?: NestResult;
    error?: string;
    progress?: number;
    overlaps?: number;
    alive?: boolean;
  };

  // ---- live preview: the best layout so far, redrawn while the search runs ----
  let previewScore = Number.POSITIVE_INFINITY;
  let previewParts: Part[] = [];
  let previewShown = false;
  let previewPending: NestResult | null = null;
  let previewTimer = 0;
  let lastPreviewDraw = 0;
  const drawPreview = (): void => {
    previewTimer = 0;
    const r = previewPending;
    previewPending = null;
    if (!r || !busy) return;
    lastPreviewDraw = Date.now();
    const out = fitEnabled() ? fitToParts(r, previewParts, toMm('margin')) : r;
    const partSvg = makePartSvg(out);
    el('svgHost').innerHTML = resultToSVG(out, previewParts, {
      ...(partSvg ? { partSvg } : {}),
      sheetLabel: (n, util) => t('app.sheetLabel', { n, util }),
    });
    if (!previewShown) {
      previewShown = true;
      zoom?.fit();
      veil.classList.add('compact');
    }
    // Live cards: sheets and fill climb as the search improves.
    const m = out.metrics;
    renderMetrics(out, {
      cutLength: m.totalCutLength,
      commonLength: 0,
      effectiveCutLength: m.totalCutLength,
      travelLength: 0,
      estimatedCutTimeSec: m.estimatedCutTimeSec,
      savedLength: 0,
      savedTimeSec: 0,
    });
  };
  const onPreview = (r: NestResult): void => {
    if (!busy || r.score >= previewScore) return;
    previewScore = r.score;
    previewPending = r;
    if (previewTimer) return;
    const wait = Math.max(0, 700 - (Date.now() - lastPreviewDraw));
    previewTimer = window.setTimeout(drawPreview, wait);
  };
  const stopPreview = (): void => {
    clearTimeout(previewTimer);
    previewTimer = 0;
    previewPending = null;
    veil.classList.remove('compact');
  };
  let lanes = { pending: 0, evals: 0, error: '', best: null as { result: NestResult; overlaps: number } | null };

  const run = (): void => {
    if (busy) return;
    const u = api.cachedUser();
    if (!api.isLoggedIn() || !u) {
      navigate('#/login');
      return;
    }
    const parts = nestParts();
    if (!parts.length) {
      statusMsg(t('app.uploadFirst'), true);
      return;
    }
    const instances = instanceCount(parts);
    const cost = u.vip ? 0 : nestCost(instances);
    if (chargeOn === 'nest' && !canAfford(u, instances)) {
      // Free nests used up and not enough credits: show the plans, don't compute.
      const reason =
        u.credits > 0 ? t('plan.notEnough', { cost, have: u.credits }) : t('plan.outOfFree');
      statusMsg(reason, true);
      openPlans(u, reason);
      return;
    }
    busy = true;
    runBtn.disabled = true;
    runCtx = { instances, strategy: STRATEGY, cost, parts, remnantId: currentRemnant()?.id ?? null };
    statusMsg(t('app.nesting', { n: instances, s: STRATEGY }));
    showVeil();
    previewScore = Number.POSITIVE_INFINITY;
    previewParts = parts;
    previewShown = false;
    const config = currentConfig();
    lanes = { pending: workers.length, evals: 0, error: '', best: null };
    workers.forEach((w, i) =>
      w.postMessage({ parts, config: { ...config, seed: ((config.seed ?? 1) + i * 7919) >>> 0, lane: i } }),
    );
    armWatchdog();
  };

  function onWorkerMessage(e: MessageEvent<WorkerMsg>): void {
    if (e.data.progress !== undefined) {
      armWatchdog(); // the engine is alive — keep waiting
      setProgress(e.data.progress);
      return;
    }
    if (e.data.alive) {
      armWatchdog();
      return;
    }
    if (e.data.preview) {
      armWatchdog();
      onPreview(e.data.preview);
      return;
    }
    if (!busy || lanes.pending <= 0) return;
    const r = e.data.result;
    if (r) {
      lanes.evals += r.iterations;
      if (!lanes.best || r.score < lanes.best.result.score) lanes.best = { result: r, overlaps: e.data.overlaps ?? 0 };
    } else if (e.data.error) {
      lanes.error ||= e.data.error;
    }
    if (--lanes.pending > 0) return;
    disarmWatchdog();
    void finishRun();
  }

  function onWorkerError(e: ErrorEvent): void {
    e.preventDefault();
    if (!busy || lanes.pending <= 0) return;
    lanes.error ||= e.message || 'worker failed';
    if (--lanes.pending > 0) return;
    disarmWatchdog();
    void finishRun();
  }

  async function finishRun(): Promise<void> {
    stopPreview();
    const best = lanes.best;
    if (!best) {
      busy = false;
      runBtn.disabled = false;
      runCtx = null;
      hideVeil(false);
      statusMsg(t('app.error', { msg: lanes.error || 'no layout' }), true);
      return;
    }
    const r = best.result;
    // Charge FIRST (the server reprices) — the paid deliverable (layout render
    // + enabled exports) only appears once the charge succeeds, so blocking or
    // failing /api/nest/complete cannot yield a free, exportable nest. `busy`
    // stays true through the await so a second run can't start mid-charge.
    if (runCtx && chargeOn === 'export') {
      // Nesting is free in this mode — the download is what gets charged.
      const ctx = runCtx;
      runCtx = null;
      lastParts = ctx.parts;
      resultRemnantId = ctx.remnantId;
      resultPaid = api.cachedUser()?.vip === true;
      resultInstances = ctx.instances;
    } else if (runCtx) {
      const ctx = runCtx;
      runCtx = null;
      try {
        const res = await api.completeNest({
          parts: ctx.instances,
          strategy: ctx.strategy,
          sheets: r.sheetsUsed,
          utilPct: Math.min(100, r.metrics.utilization * 100),
        });
        const fresh = api.cachedUser();
        if (fresh) refreshPill(fresh);
        lastParts = ctx.parts;
        resultRemnantId = ctx.remnantId;
        resultPaid = true;
        resultInstances = ctx.instances;
      } catch (err) {
        busy = false;
        runBtn.disabled = false;
        hideVeil(false);
        updateCostLabel();
        if (err instanceof api.ApiError && err.status === 401) {
          navigate('#/login');
          return;
        }
        if (err instanceof api.ApiError && err.status === 402) {
          const reason = t('plan.outOfFree');
          statusMsg(reason, true);
          openPlans(api.cachedUser(), reason);
          return;
        }
        statusMsg(err instanceof api.ApiError ? err.message : t('app.chargeFail'), true);
        return; // result intentionally not rendered or exportable
      }
    }
    busy = false;
    runBtn.disabled = false;
    // Crop the sheet to the packed parts for a clean, full layout (auto-size).
    resultFit = fitEnabled();
    const out = resultFit ? fitToParts(r, lastParts, toMm('margin')) : r;
    undoStack.length = 0;
    render(out);
    hideVeil(true);
    runId = store.newId();
    saveRun(out);
    if (best.overlaps > 0) {
      statusMsg(t('app.overlapWarn', { n: best.overlaps }), true);
    } else {
      statusMsg(
        t('app.done', { sec: (r.elapsedMs / 1000).toFixed(1), n: r.placements.length, layouts: lanes.evals }) +
          (r.unplaced.length ? ` · ${t('app.didNotFit', { n: r.unplaced.length })}` : '') +
          (resultPaid ? '' : ` · ${t('app.payToExport')}`),
      );
    }
    updateCostLabel();
  }

  function spawnWorkers(): void {
    workers = Array.from({ length: LANES }, () => {
      const w = new Worker(new URL('../nest.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = onWorkerMessage;
      w.onerror = onWorkerError;
      return w;
    });
  }
  spawnWorkers();

  // If the engine goes silent for this long, the job is stuck on pathological
  // geometry — kill the workers instead of hanging at 99% forever. The engine
  // heartbeats after every placed part, so a healthy run is never this quiet.
  // No credits are lost: charging only ever happens after a result arrives.
  const WATCHDOG_MS = 120_000;
  function armWatchdog(): void {
    clearTimeout(watchdog);
    watchdog = window.setTimeout(() => {
      workers.forEach((w) => w.terminate());
      spawnWorkers();
      stopPreview();
      busy = false;
      runCtx = null;
      lanes.pending = 0;
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
  // Importers speak English; show their known warnings in the UI language.
  const localizeWarning = (w: string): string => {
    const n = /(\d+)/.exec(w)?.[1] ?? '';
    if (/capped/i.test(w)) return t('warn.capped', { n });
    if (/frame/i.test(w)) return t('warn.frame');
    if (/Double-outline/i.test(w)) return t('warn.traced');
    if (/block insert/i.test(w)) return t('warn.inserts', { n });
    if (/open outline/i.test(w)) return t('warn.open', { n });
    return w;
  };

  // The format as the user knows it (a PDF stays "PDF" after conversion).
  const fmtLabel = (text: string, name: string): string => {
    const ext = extOf(name);
    if (SERVER_FORMATS.has(ext)) return ext.toUpperCase();
    if (ext === 'lbrn' || ext === 'lbrn2') return 'LightBurn';
    return isDxf(text, name) ? 'DXF' : 'SVG';
  };
  // Real-size fields, info line and parts panel follow the job (no preview reset).
  const syncJobUi = (): void => {
    rebuildJobData();
    activeFile = Math.min(activeFile, Math.max(0, files.length - 1));
    const f = files[activeFile];
    const wEl = el<HTMLInputElement>('realW');
    const hEl = el<HTMLInputElement>('realH');
    const sized = !!f && f.w > 0;
    wEl.disabled = !sized;
    hEl.disabled = !sized;
    if (sized) {
      setLen('realW', f.w);
      setLen('realH', f.h);
    } else {
      wEl.value = '';
      hEl.value = '';
    }
    if (!f) {
      importInfo.textContent = t('app.uploadHint');
      importInfo.classList.remove('warn');
    } else {
      const warn = files.flatMap((x) => x.warnings);
      const n = instanceCount(importedParts);
      importInfo.classList.toggle('warn', warn.length > 0);
      importInfo.textContent =
        (files.length === 1
          ? t('app.importedShapes', { n, fmt: fmtLabel(f.text, f.name) }) + (sized ? ` · ${Math.round(f.w)}×${Math.round(f.h)} mm` : '')
          : t('parts.jobInfo', { files: files.length, n })) +
        (f.note ? ' · ' + f.note : '') +
        (warn.length ? ' · ' + localizeWarning(warn[0]!) : '');
    }
    panel.update({ files, overrides, active: activeFile });
    updateCostLabel();
    markRemnantFit();
  };
  const refreshJob = (label = t('app.partsReady')): void => {
    syncJobUi();
    showPreview(files.length ? label : '');
  };

  // A NEW file always starts at its true size (scale 1): a real-size
  // correction typed for the previous file must never silently rescale the
  // next one (that bug made a 12.5 cm part come out 12.2 cm). `add` keeps the
  // drawings already in the job; otherwise the job starts over.
  const openFile = (text: string, name: string, note = '', add = false): boolean => {
    const meta = job.nextFileMeta(add ? files : []);
    const loaded = job.loadJobFile({ ...meta, name, text, scale: 1, note, layersOff: [] });
    if (!loaded.parts.length && !loaded.layers.length) {
      importInfo.textContent = loaded.warnings[0] ? localizeWarning(loaded.warnings[0]) : t('parts.noShapes');
      importInfo.classList.add('warn');
      return false;
    }
    if (add) {
      files = [...files, loaded];
      activeFile = files.length - 1;
    } else {
      files = [loaded];
      activeFile = 0;
      overrides.clear();
    }
    refreshJob();
    return loaded.parts.length > 0;
  };

  const reloadFile = (i: number, change: Partial<job.JobFile>): void => {
    files = files.map((x, j) => (j === i ? job.loadJobFile({ ...job.jobData(x), ...change }) : x));
  };

  const panel = createPartsPanel(el('jobPanel'), {
    quantity: (id, qty) => {
      overrides.set(id, { ...overrides.get(id), qty });
      refreshJob(readyLabel());
    },
    rotation: (id, step) => {
      const o: job.PartOverride = { ...overrides.get(id) };
      if (step) o.rot = step;
      else delete o.rot;
      overrides.set(id, o);
      refreshJob(readyLabel());
    },
    multiply: (k) => {
      for (const x of files) {
        for (const p of x.parts) {
          const cur = overrides.get(p.id)?.qty ?? p.quantity ?? 1;
          overrides.set(p.id, { ...overrides.get(p.id), qty: Math.min(100000, cur * k) });
        }
      }
      refreshJob(readyLabel());
    },
    resetQuantities: () => {
      for (const [id, o] of overrides) {
        const next: job.PartOverride = { ...o };
        delete next.qty;
        overrides.set(id, next);
      }
      refreshJob(readyLabel());
    },
    activateFile: (i) => {
      activeFile = i;
      syncJobUi();
    },
    removeFile: (i) => {
      for (const p of files[i]?.parts ?? []) overrides.delete(p.id);
      files = files.filter((_, j) => j !== i);
      refreshJob(readyLabel());
    },
    addFile: () => el<HTMLInputElement>('fileAdd').click(),
    clear: () => {
      files = [];
      overrides.clear();
      refreshJob();
    },
    layer: (i, layer, cut) => {
      const x = files[i];
      if (!x) return;
      const off = new Set(x.layersOff);
      if (cut) off.delete(layer);
      else off.add(layer);
      // Part numbering changes with the layers — per-part choices start over.
      for (const p of x.parts) overrides.delete(p.id);
      reloadFile(i, { layersOff: [...off] });
      refreshJob(readyLabel());
    },
    highlight: (id) => {
      const host = el('svgHost');
      host.querySelectorAll('.pt-hl').forEach((n) => n.classList.remove('pt-hl'));
      if (!id) return;
      host.querySelectorAll(`[data-part="${CSS.escape(id)}"]`).forEach((n) => n.classList.add('pt-hl'));
      lastResult?.placements.forEach((p, i) => {
        if (p.partId === id) host.querySelector(`.nf-part[data-pl="${i}"]`)?.classList.add('pt-hl');
      });
    },
  });

  // Any supported file: SVG / DXF read as text, LightBurn converted here,
  // PDF / AI / EPS / CDR / DWG converted on the server.
  let converting = false;
  const openUpload = async (file: File, add = false): Promise<void> => {
    const ext = extOf(file.name);
    const fmt = SERVER_FORMATS.has(ext) ? ext.toUpperCase() : ext === 'lbrn' || ext === 'lbrn2' ? 'LightBurn' : ext.toUpperCase();
    const fail = (msg: string): void => {
      importInfo.textContent = msg;
      importInfo.classList.add('warn');
      statusMsg(msg, true);
    };
    if (file.size > MAX_UPLOAD) {
      fail(t('conv.tooBig', { mb: Math.round(MAX_UPLOAD / 1024 / 1024) }));
      return;
    }
    if (ext === 'lbrn' || ext === 'lbrn2') {
      try {
        const res = lbrnToSvg(await file.text());
        openFile(res.svg, file.name, res.skippedText ? t('conv.lbrnText', { n: res.skippedText }) : '', add);
      } catch {
        fail(t('conv.failed', { fmt }));
      }
      return;
    }
    if (!SERVER_FORMATS.has(ext)) {
      openFile(await file.text(), file.name, '', add);
      return;
    }
    if (converting || busy) return;
    converting = true;
    importInfo.classList.remove('warn');
    importInfo.textContent = t('conv.working', { fmt });
    statusMsg(t('conv.working', { fmt }));
    try {
      const out = await api.convertFile(file);
      const note = out.pages > 1 ? t('conv.pages', { n: out.pages }) : '';
      // Keep the real extension for the label, but let the importer see the converted text.
      if (!openFile(out.text, file.name, note, add)) fail(t('conv.empty', { fmt }));
    } catch (err) {
      if (err instanceof api.ApiError && err.status === 401) {
        navigate('#/login');
        return;
      }
      const code = err instanceof api.ApiError ? err.message : '';
      fail(
        code === 'converter_unavailable'
          ? t('conv.unavailable', { fmt })
          : code === 'busy'
            ? t('conv.busy')
            : code === 'unsupported_format'
              ? t('conv.unsupported', { fmt })
              : t('conv.failed', { fmt }),
      );
    } finally {
      converting = false;
    }
  };

  const fileInput = el<HTMLInputElement>('file');
  el('browse').addEventListener('click', () => fileInput.click());
  el('drop').addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id !== 'browse') fileInput.click();
  });
  const openMany = async (list: File[], add: boolean): Promise<void> => {
    for (let i = 0; i < list.length; i++) await openUpload(list[i]!, add || i > 0);
  };
  fileInput.addEventListener('change', () => {
    const list = Array.from(fileInput.files ?? []);
    fileInput.value = ''; // re-selecting the same file must fire 'change' again
    if (list.length) void openMany(list, false);
  });
  const fileAdd = el<HTMLInputElement>('fileAdd');
  fileAdd.addEventListener('change', () => {
    const list = Array.from(fileAdd.files ?? []);
    fileAdd.value = '';
    if (list.length) void openMany(list, true);
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
    const list = Array.from((e as DragEvent).dataTransfer?.files ?? []);
    if (list.length) void openMany(list, false);
  });
  // Typing the REAL width or height rescales the whole import proportionally —
  // fixes files exported without unit info (common from CorelDRAW).
  const applyRealSize = (dim: 'w' | 'h'): void => {
    const x = files[activeFile];
    if (!x || !(x.w > 0)) return;
    const wanted = toMm(dim === 'w' ? 'realW' : 'realH');
    const cur = dim === 'w' ? x.w : x.h;
    if (!(wanted > 0) || !(cur > 0)) return;
    reloadFile(activeFile, { scale: x.scale * (wanted / cur) });
    refreshJob();
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
  exportDxfBtn.addEventListener('click', async () => {
    if (!lastResult || !(await ensurePaid()) || !lastResult) return;
    const layers = el<HTMLSelectElement>('dxfLayers').value as 'split' | 'source' | 'single';
    exportDxf(lastResult, lastParts, currentFine(), { layers, blocks: checked('dxfBlocks'), partLayers });
  });
  exportPdfBtn.addEventListener('click', async () => {
    if (!lastResult) return;
    // Open the report window inside the click, before any await (popup blockers).
    const win = resultPaid ? null : window.open('', '_blank');
    if (!(await ensurePaid()) || !lastResult) {
      win?.close();
      return;
    }
    const partSvg = makePartSvg(lastResult);
    openReport(
      {
        result: lastResult,
        parts: lastParts,
        cut: cutMetrics(lastPlans, currentConfig()),
        fileName: importedName,
        sheetCost: num('sheetCost'),
        ...(partSvg ? { partSvg } : {}),
      },
      win,
    );
  });
  // DXF export choices are remembered in this browser.
  try {
    const l = localStorage.getItem('nf_dxf_layers');
    if (l === 'split' || l === 'source' || l === 'single') el<HTMLSelectElement>('dxfLayers').value = l;
    el<HTMLInputElement>('dxfBlocks').checked = localStorage.getItem('nf_dxf_blocks') === '1';
  } catch {
    /* storage blocked — defaults */
  }
  el('dxfLayers').addEventListener('change', () => {
    try {
      localStorage.setItem('nf_dxf_layers', el<HTMLSelectElement>('dxfLayers').value);
    } catch {
      /* ignore */
    }
  });
  el('dxfBlocks').addEventListener('change', () => {
    try {
      localStorage.setItem('nf_dxf_blocks', checked('dxfBlocks') ? '1' : '0');
    } catch {
      /* ignore */
    }
  });
  el('showPath').addEventListener('change', () => {
    if (lastResult) render(lastResult);
  });

  // ---- remnants: the leftover of a sheet, filled first by a later job ----
  const remnantThumb = (rem: store.RemnantEntry): string => {
    const d = rem.blocked
      .map((r) => r.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + 'Z')
      .join(' ');
    const sw = Math.max(rem.width, rem.height) / 150;
    return `<svg viewBox="${-sw} ${-sw} ${rem.width + 2 * sw} ${rem.height + 2 * sw}" xmlns="http://www.w3.org/2000/svg"><rect width="${rem.width}" height="${rem.height}" fill="#111827" stroke="#334155" stroke-width="${sw}"/><path d="${d}" fill="#475569"/></svg>`;
  };
  const remnantLabel = (r: store.RemnantEntry): string => (r.sheet ? `${r.name} · ${t('rem.sheetN', { n: r.sheet })}` : r.name);
  // A remnant whose free area can take the whole current job gets a ✓.
  const jobArea = (): number =>
    currentParts().reduce((sum, p) => sum + Math.abs(contourArea(p.contour)) * (p.quantity ?? 1), 0);
  const remnantFits = (r: store.RemnantEntry, need: number): boolean =>
    need > 0 && r.free * (r.width - 2 * r.margin) * (r.height - 2 * r.margin) >= need * 1.15;
  const remnantOptionText = (r: store.RemnantEntry, need = jobArea()): string =>
    `${remnantFits(r, need) ? '✓ ' : ''}${remnantLabel(r)} · ${Math.round(r.width)}×${Math.round(r.height)} · ${Math.round(r.free * 100)}% ${t('rem.free')}${remnantFits(r, need) ? ` · ${t('rem.fits')}` : ''}`;
  const markRemnantFit = (): void => {
    const need = jobArea();
    for (const opt of Array.from(remnantSel.options)) {
      const r = remnantList.find((x) => x.id === opt.value);
      if (r) opt.textContent = remnantOptionText(r, need);
    }
  };
  const showRemnant = (): void => {
    const rem = currentRemnant();
    const thumb = el('remnantThumb');
    thumb.hidden = rem === null;
    if (rem) {
      setLen('sheetW', rem.width);
      setLen('sheetH', rem.height);
      setLen('margin', rem.margin);
      el<HTMLInputElement>('fitSheet').checked = false;
      thumb.innerHTML = remnantThumb(rem) + `<p class="hint">${t('rem.hint')}</p>`;
    } else {
      thumb.innerHTML = '';
    }
    syncSheetInputs();
    updateCostLabel();
  };
  const refreshRemnants = async (keep?: string): Promise<void> => {
    remnantList = await store.listRemnants();
    const want = keep ?? remnantSel.value;
    remnantSel.innerHTML =
      `<option value="">${esc(t('rem.none'))}</option>` +
      remnantList
        .map(
          (r) =>
            `<option value="${r.id}">${esc(remnantOptionText(r))}</option>`,
        )
        .join('');
    remnantSel.value = remnantList.some((r) => r.id === want) ? want : '';
    showRemnant();
  };
  remnantSel.addEventListener('change', () => {
    showRemnant();
    if (currentParts().length && !busy) showPreview(readyLabel());
  });
  el('remnantDel').addEventListener('click', () => {
    const rem = currentRemnant();
    if (!rem || !window.confirm(t('rem.confirmDel', { name: remnantLabel(rem) }))) return;
    void store.deleteRemnant(rem.id).then(() => refreshRemnants(''));
  });
  saveRemnantBtn.addEventListener('click', () => {
    if (!lastResult || resultFit) return;
    const r = lastResult;
    const sheet = Math.max(0, r.sheetsUsed - 1);
    const rem = remnantFromSheet(r, lastParts, sheet);
    const { width, height, margin = 0 } = r.config.sheet;
    const free = remnantFreeFraction(rem, width, height, margin);
    const entry: store.RemnantEntry = {
      id: store.newId(),
      at: Date.now(),
      name: importedName || 'Tasvir AI',
      sheet: sheet + 1,
      width,
      height,
      margin,
      blocked: rem.blocked,
      free,
    };
    saveRemnantBtn.disabled = true;
    // The remnant this job was nested on is used up now — the new entry replaces it.
    const used = resultRemnantId;
    resultRemnantId = null;
    void (async () => {
      await store.saveRemnant(entry);
      if (used) await store.deleteRemnant(used);
      await refreshRemnants(used && remnantSel.value === used ? '' : undefined);
      statusMsg(t('rem.saved', { n: sheet + 1, free: Math.round(free * 100) }));
    })();
  });

  // ---- history: every finished job, reopened without paying again ----
  const saveRun = (r: NestResult): void => {
    if (!runId || !files.length) return;
    void store
      .saveHistory({
        id: runId,
        at: Date.now(),
        name: importedName || 'Tasvir AI',
        files: files.map(job.jobData),
        overrides: Object.fromEntries(overrides),
        mirror: mirrorMode(),
        result: r,
        parts: r.placements.length,
        sheets: r.sheetsUsed,
        util: r.metrics.utilization,
        paid: resultPaid,
      })
      .then(() => refreshHistory());
  };
  let saveEditTimer = 0;
  const saveEdit = (r: NestResult): void => {
    clearTimeout(saveEditTimer);
    saveEditTimer = window.setTimeout(() => saveRun(r), 800);
  };
  const fmtWhen = (ts: number): string => {
    const d = new Date(ts);
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const refreshHistory = async (): Promise<void> => {
    const list = await store.listHistory();
    el('histCount').textContent = list.length ? `(${list.length})` : '';
    el('histList').innerHTML = list.length
      ? list
          .map(
            (h) => `<div class="hist-item${h.id === runId ? ' current' : ''}" data-id="${h.id}">
          <div class="hi-main"><b title="${esc(h.name)}">${esc(h.name)}</b>
            <small>${fmtWhen(h.at)}</small>
            <small>${esc(t('hist.meta', { parts: h.parts, sheets: h.sheets, util: (h.util * 100).toFixed(1) }))}</small></div>
          <button type="button" class="hi-open">${esc(t('hist.open'))}</button>
          <button type="button" class="hi-del icon-btn" title="${esc(t('hist.delete'))}" aria-label="${esc(t('hist.delete'))}">✕</button>
        </div>`,
          )
          .join('')
      : `<p class="hint">${esc(t('hist.empty'))}</p>`;
  };
  const restoreHistory = (h: store.HistoryEntry): void => {
    if (busy) return;
    const c = h.result.config;
    // The settings the job was nested with.
    remnantSel.value = '';
    el<HTMLInputElement>('fitSheet').checked = false;
    setLen('sheetW', c.sheet.width);
    setLen('sheetH', c.sheet.height);
    setLen('margin', c.sheet.margin ?? 0);
    setLen('spacing', c.spacing ?? 0);
    el<HTMLInputElement>('kerf').value = String(c.kerf ?? 0);
    el<HTMLInputElement>('holeFilling').checked = c.holeFilling === true;
    const turns = new Set((c.rotations ?? [0]).map((r) => ((Math.round(r) % 360) + 360) % 360)).size;
    const step = turns <= 1 ? '0' : String(Math.round(360 / turns));
    el<HTMLSelectElement>('rotStep').value = ['0', '180', '90', '45', '15'].includes(step) ? step : '90';
    el<HTMLInputElement>('maxSheets').value = c.sheet.quantity && Number.isFinite(c.sheet.quantity) ? String(c.sheet.quantity) : '';
    const preset =
      c.sheet.width === 1210 && c.sheet.height === 900 ? 'laser' : c.sheet.width === 2400 && c.sheet.height === 1200 ? 'rover' : 'custom';
    el<HTMLSelectElement>('machinePreset').value = preset;
    el<HTMLSelectElement>('mirrorMode').value = h.mirror || 'off';
    showRemnant();
    const saved: job.JobFile[] = h.files ?? [
      { id: 'f1', name: h.name, text: h.text ?? '', scale: h.scale ?? 1, note: '', prefix: '', layersOff: [] },
    ];
    files = saved.map(job.loadJobFile);
    activeFile = 0;
    overrides.clear();
    for (const [k, v] of Object.entries(h.overrides ?? {})) overrides.set(k, v);
    refreshJob();
    const parts = nestParts();
    const ids = new Set(parts.map((p) => p.id));
    if (!h.result.placements.every((p) => ids.has(p.partId))) {
      statusMsg(t('hist.mismatch'), true);
      return;
    }
    lastParts = parts;
    resultRemnantId = null;
    resultFit = false;
    resultPaid = h.paid !== false;
    resultInstances = h.result.placements.length + h.result.unplaced.length;
    runId = h.id;
    undoStack.length = 0;
    render(h.result);
    statusMsg(t('hist.restored', { name: h.name }));
    void refreshHistory();
  };
  el('histList').addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const item = target.closest<HTMLElement>('.hist-item');
    if (!item) return;
    const id = item.dataset.id ?? '';
    if (target.closest('.hi-del')) {
      void store.deleteHistory(id).then(() => refreshHistory());
      return;
    }
    if (target.closest('.hi-open')) {
      void store.listHistory().then((list) => {
        const h = list.find((x) => x.id === id);
        if (h) restoreHistory(h);
      });
    }
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

  // ---- hand editing: drag (also to another sheet), turn, nudge, remove, undo ----
  let editMode = false;
  const editBar = el('editBar');
  const syncEditBar = (index: number | null): void => {
    const pl = index !== null ? lastResult?.placements[index] : undefined;
    el('ebSel').textContent = pl ? t('edit.selected', { n: index! + 1, deg: Math.round(pl.rotation) }) : t('edit.pick');
    editBar.querySelectorAll<HTMLButtonElement>('[data-rot], #ebRotate, #ebDelete').forEach((b) => {
      b.disabled = !pl;
    });
    el<HTMLButtonElement>('ebUndo').disabled = undoStack.length === 0;
  };
  const setEditMode = (on: boolean): void => {
    editMode = on;
    editBtn.classList.toggle('active', on);
    editBar.hidden = !on;
    viewport.classList.toggle('nf-edit', on);
    if (!on) editor.select(null);
    else {
      statusMsg(t('app.editHint'));
      syncEditBar(editor.selected());
    }
  };
  const undoEdit = (): void => {
    const prev = undoStack.pop();
    if (!prev) return;
    render(prev, true);
    editor.select(null);
    saveEdit(prev);
    statusMsg(t('edit.undone'));
  };
  editor = attachEditor({
    svgHost: el('svgHost'),
    active: () => editMode && !busy && lastResult !== null,
    result: () => lastResult,
    parts: () => lastParts,
    gap: () => {
      const c = lastResult?.config;
      return c ? (c.spacing ?? 0) + (c.kerf ?? 0) : toMm('spacing') + num('kerf');
    },
    commit: (next, index) => {
      if (lastResult) {
        undoStack.push(lastResult);
        if (undoStack.length > 50) undoStack.shift();
      }
      render(next, true);
      editor.select(index);
      statusMsg(t(index === null ? 'edit.deleted' : 'app.editSaved'));
      saveEdit(next);
    },
    reject: (verdict) => statusMsg(t(verdict === 'outside' ? 'app.editOutside' : 'app.editOverlap'), true),
    selected: (i) => syncEditBar(i),
    undo: undoEdit,
  });
  editBtn.addEventListener('click', () => setEditMode(!editMode));
  editBar.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b || b.disabled) return;
    if (b.dataset.rot) editor.rotateSelected(Number(b.dataset.rot));
    else if (b.id === 'ebRotate') editor.rotateSelected(Number(el<HTMLInputElement>('ebAngle').value) || 0);
    else if (b.id === 'ebDelete') editor.deleteSelected();
    else if (b.id === 'ebUndo') undoEdit();
  });

  // Restore work that survived a re-render (e.g. a language switch): the mirror
  // state must be restored BEFORE rendering so a mirrored result is redrawn with
  // mirrored sources, and the paid result reappears instead of a blank preview.
  const keepRemnant = savedWork?.remnantId ?? '';
  void refreshRemnants(keepRemnant);
  void refreshHistory();
  if (savedWork) el<HTMLSelectElement>('mirrorMode').value = savedWork.mirrorMode || 'off';
  syncJobUi();
  updateCostLabel();
  syncSheetInputs();
  if (lastResult) {
    const keepRun = runId;
    render(lastResult);
    runId = keepRun;
    statusEl.textContent = readyLabel();
  } else {
    showPreview(readyLabel());
  }
  savedWork = null;

  // Which moment is charged (admin setting): each nest, or the download.
  void api.getConfig().then((cfg) => {
    chargeOn = cfg.chargeOn === 'export' ? 'export' : 'nest';
    updateCostLabel();
  });

  // Refresh the balance from the server (kicks stale sessions back to login).
  api
    .me()
    .then((fresh) => {
      if (!fresh) {
        navigate('#/login');
        return;
      }
      // The cached session may be stale (a plan granted meanwhile): redraw.
      refreshPill(fresh);
      updateCostLabel();
    })
    .catch((err) => {
      if (err instanceof api.ApiError && err.status === 401) navigate('#/login');
      // Network failure: keep the cached view usable; charging will surface errors.
    });

  return () => {
    disarmWatchdog();
    stopPreview();
    clearTimeout(saveEditTimer);
    workers.forEach((w) => w.terminate());
    editor.destroy();
    zoom?.destroy();
    clearInterval(veilTimer);
    savedWork = {
      files,
      activeFile,
      overrides: [...overrides],
      lastParts,
      lastResult,
      lastPlans,
      mirrorMode: mirrorMode(),
      runId,
      remnantId: remnantSel.value,
      resultRemnantId,
      resultFit,
      resultPaid,
      resultInstances,
    };
  };
}
