import './style.css';
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
import { buildSampleSet, type SampleKey } from './samples';
import { importSvgParts } from './svgImport';
import { importDxfParts } from './dxfImport';
import { textToParts } from './textToParts';
import { exportDxf, exportSvg } from './exporters';

const worker = new Worker(new URL('./nest.worker.ts', import.meta.url), { type: 'module' });

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
let busy = false;

const statusEl = el('status');
const runBtn = el<HTMLButtonElement>('run');
const viewport = el('viewport');
const metricsEl = el('metrics');
const importInfo = el('importInfo');
const exportSvgBtn = el<HTMLButtonElement>('exportSvg');
const exportDxfBtn = el<HTMLButtonElement>('exportDxf');

function currentParts(): Part[] {
  if (mode === 'imported' && importedParts.length) return importedParts;
  return buildSampleSet(el<HTMLSelectElement>('sampleSet').value as SampleKey);
}

function currentConfig(): NestConfig {
  const rotations = Array.from(document.querySelectorAll<HTMLInputElement>('.rot:checked')).map((r) =>
    Number(r.value),
  );
  const timeLimitMs = strategy === 'max' ? 8000 : strategy === 'balanced' ? 4000 : undefined;
  const config: NestConfig = {
    sheet: { width: num('sheetW'), height: num('sheetH'), margin: num('margin'), cost: num('sheetCost') },
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
}

function metricCard(label: string, value: string, good = false): string {
  return `<div class="card${good ? ' good' : ''}"><div class="k">${label}</div><div class="v">${value}</div></div>`;
}

function renderMetrics(r: NestResult, cm: CutMetrics): void {
  const m = r.metrics;
  const cutSec = cm.estimatedCutTimeSec || m.estimatedCutTimeSec;
  const mins = Math.floor(cutSec / 60);
  const secs = Math.round(cutSec % 60);
  metricsEl.innerHTML = [
    metricCard('Sheets used', `${r.sheetsUsed} <small>/ naive ${m.baselineSheets}</small>`),
    metricCard('Utilization', `${(m.utilization * 100).toFixed(1)}<small>%</small>`),
    metricCard('Saved', `$${m.savedMoney.toFixed(0)}`, m.savedMoney > 0),
    metricCard('Cut length', `${(cm.effectiveCutLength / 1000).toFixed(2)}<small>m</small>`),
    metricCard('Common-line saved', `${(cm.savedLength / 1000).toFixed(2)}<small>m</small>`, cm.savedLength > 0),
    metricCard('Cut time', `${mins}<small>m</small> ${secs}<small>s</small>`),
    metricCard('Unplaced', String(r.unplaced.length), r.unplaced.length === 0),
  ].join('');
}

function render(r: NestResult): void {
  lastResult = r;
  lastPlans = planCutPath(r, lastParts);
  const cm = cutMetrics(lastPlans, currentConfig());
  const showPath = checked('showPath');
  viewport.innerHTML = resultToSVG(r, lastParts, showPath ? { cutPlans: lastPlans } : {});
  renderMetrics(r, cm);
  exportSvgBtn.disabled = false;
  exportDxfBtn.disabled = false;
  statusEl.textContent = `Done in ${r.elapsedMs} ms · ${r.placements.length} placed · ${r.iterations} layouts` +
    (r.unplaced.length ? ` · ${r.unplaced.length} did not fit` : '');
}

function run(): void {
  if (busy) return;
  const parts = currentParts();
  if (!parts.length) {
    statusEl.textContent = 'No parts to nest.';
    return;
  }
  busy = true;
  runBtn.disabled = true;
  lastParts = parts;
  const total = parts.reduce((s, p) => s + (p.quantity ?? 1), 0);
  statusEl.textContent = `Nesting ${total} parts (${strategy})…`;
  worker.postMessage({ parts, config: currentConfig() });
}

worker.onmessage = (e: MessageEvent<{ result?: NestResult; error?: string }>) => {
  busy = false;
  runBtn.disabled = false;
  if (e.data.error) {
    statusEl.textContent = `Error: ${e.data.error}`;
    return;
  }
  if (e.data.result) render(e.data.result);
};
worker.onerror = (e) => {
  busy = false;
  runBtn.disabled = false;
  statusEl.textContent = `Worker error: ${e.message}`;
};

function isDxf(text: string, name: string): boolean {
  if (/\.dxf$/i.test(name)) return true;
  if (/\.svg$/i.test(name) || /<svg[\s>]/i.test(text)) return false;
  return /\bENTITIES\b/.test(text) && /\bSECTION\b/.test(text);
}

function loadFile(text: string, name: string): void {
  importedText = text;
  importedName = name;
  const scale = num('scale') || 1;
  const { parts, warnings } = isDxf(text, name)
    ? importDxfParts(text, scale)
    : importSvgParts(text, scale);
  if (!parts.length) {
    importInfo.textContent = warnings[0] ?? 'No shapes found.';
    importInfo.classList.add('warn');
    return;
  }
  importedParts = parts;
  mode = 'imported';
  importInfo.classList.toggle('warn', warnings.length > 0);
  const kind = isDxf(text, name) ? 'DXF' : 'SVG';
  importInfo.textContent = `Imported ${parts.length} shapes from ${kind}${warnings.length ? ' · ' + warnings[0] : ''}`;
  run();
}

// --- File input & drag/drop ---
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
async function makeLetters(): Promise<void> {
  const text = el<HTMLInputElement>('text').value;
  const h = Number(el<HTMLInputElement>('letterH').value) || 80;
  importInfo.classList.remove('warn');
  importInfo.textContent = 'Building letters…';
  try {
    const parts = await textToParts(text, h);
    if (!parts.length) {
      importInfo.textContent = 'No letters to cut (spaces only?).';
      importInfo.classList.add('warn');
      return;
    }
    importedParts = parts;
    mode = 'imported';
    importedText = null;
    importedName = '';
    importInfo.textContent = `Generated ${parts.length} letter pieces from “${text.trim()}”`;
    run();
  } catch (err) {
    importInfo.textContent = `Could not build letters: ${err instanceof Error ? err.message : String(err)}`;
    importInfo.classList.add('warn');
  }
}
el('makeText').addEventListener('click', makeLetters);
el('text').addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Enter') makeLetters();
});

// --- Strategy segmented control ---
document.querySelectorAll<HTMLButtonElement>('#strategy button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#strategy button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    strategy = (btn.dataset.val as Strategy) ?? 'fast';
  });
});

el('sampleSet').addEventListener('change', () => {
  mode = 'sample';
  importInfo.classList.remove('warn');
  importInfo.textContent = 'Using a built-in sample set.';
  run();
});

runBtn.addEventListener('click', run);
exportSvgBtn.addEventListener('click', () => lastResult && exportSvg(lastResult, lastParts));
exportDxfBtn.addEventListener('click', () => lastResult && exportDxf(lastResult, lastParts));
el('showPath').addEventListener('change', () => {
  if (lastResult) render(lastResult);
});

run();
