import { contourArea, resultToSVG, ringBounds, type CutMetrics, type NestResult, type Part, type Placement } from '@nestflow/engine';
import { t } from './i18n';

/**
 * Printable job report — the "PDF report" a shop hands to its customer or
 * keeps with the job: a summary (parts, sheets, fill, material cost, cut
 * length and time), the parts list, and every sheet drawn on its own page.
 * It opens in a new window and starts the browser's print dialog, where
 * "Save as PDF" produces the file (native fonts, so Uzbek/Russian text and
 * true vector drawings come out exactly).
 */

export interface ReportInput {
  result: NestResult;
  parts: Part[];
  cut: CutMetrics;
  fileName: string;
  sheetCost: number;
  partSvg?: (partId: string, placement: Placement) => string | null;
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'));

const mm = (v: number): string => (Math.round(v * 10) / 10).toString();

export function openReport(input: ReportInput): void {
  const { result, parts, cut } = input;
  const win = window.open('', '_blank');
  if (!win) return;
  const W = result.config.sheet.width;
  const H = result.config.sheet.height;
  const partMap = new Map(parts.map((p) => [p.id, p]));
  const sheets = Math.max(1, result.sheetsUsed);

  // Summary.
  const minutes = Math.floor(cut.estimatedCutTimeSec / 60);
  const seconds = Math.round(cut.estimatedCutTimeSec % 60);
  const cost = sheets * (input.sheetCost || 0);
  const rows: Array<[string, string]> = [
    [t('rep.parts'), String(result.placements.length)],
    [t('rep.sheets'), String(result.sheetsUsed)],
    [t('rep.sheetSize'), `${mm(W)} × ${mm(H)} mm`],
    [t('rep.util'), `${(result.metrics.utilization * 100).toFixed(1)}%`],
    [t('rep.material'), cost > 0 ? `${cost.toFixed(0)} $` : '—'],
    [t('rep.cutLen'), `${(cut.effectiveCutLength / 1000).toFixed(2)} m`],
    [t('rep.cutTime'), `${minutes} min ${seconds} s`],
    [t('rep.spacing'), `${mm(result.config.spacing ?? 0)} / ${mm(result.config.kerf ?? 0)} mm`],
  ];

  // Parts list (unique parts, true size, placed count).
  const placed = new Map<string, number>();
  for (const pl of result.placements) placed.set(pl.partId, (placed.get(pl.partId) ?? 0) + 1);
  const partRows = parts
    .filter((p) => placed.has(p.id))
    .map((p, i) => {
      const b = ringBounds(p.contour.outer);
      return `<tr><td>${i + 1}</td><td>${esc(p.label ?? p.id)}</td><td>${mm(b.maxX - b.minX)} × ${mm(b.maxY - b.minY)}</td><td>${placed.get(p.id)}</td></tr>`;
    })
    .join('');

  // One page per sheet.
  const sheetPages: string[] = [];
  for (let s = 0; s < sheets; s++) {
    const onSheet = result.placements.filter((pl) => pl.sheet === s).map((pl) => ({ ...pl, sheet: 0 }));
    let area = 0;
    for (const pl of onSheet) {
      const part = partMap.get(pl.partId);
      if (part) area += Math.abs(contourArea(part.contour));
    }
    const single: NestResult = { ...result, sheetsUsed: 1, placements: onSheet };
    const svg = resultToSVG(single, parts, {
      palette: 'light',
      labels: false,
      background: false,
      ...(input.partSvg ? { partSvg: input.partSvg } : {}),
    });
    sheetPages.push(`
      <section class="sheet">
        <h2>${esc(t('rep.sheetN', { n: s + 1, total: sheets, util: ((area / (W * H)) * 100).toFixed(1) }))} · ${t('rep.partsOn', { n: onSheet.length })}</h2>
        <div class="drawing">${svg}</div>
      </section>`);
  }

  const date = new Date().toLocaleString();
  win.document.write(`<!doctype html><html><head><meta charset="utf-8" />
<title>${esc(t('rep.title'))} — ${esc(input.fileName || 'Tasvir AI')}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Inter, Segoe UI, Roboto, Arial, sans-serif; color: #111827; margin: 0; padding: 24px; background: #fff; }
  .bar { position: sticky; top: 0; display: flex; gap: 12px; align-items: center; justify-content: space-between; padding: 12px 16px; margin: -24px -24px 20px; background: #0f172a; color: #e5e7eb; font-size: 13px; }
  .bar button { background: #6366f1; color: #fff; border: 0; border-radius: 8px; padding: 9px 16px; font-weight: 600; cursor: pointer; font-size: 14px; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111827; padding-bottom: 10px; margin-bottom: 16px; }
  header h1 { margin: 0; font-size: 22px; }
  header .brand { font-weight: 800; font-size: 15px; letter-spacing: .02em; }
  header .meta { text-align: right; font-size: 12px; color: #4b5563; line-height: 1.5; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 18px; }
  .cell { border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 10px; }
  .cell .k { font-size: 10.5px; color: #6b7280; text-transform: uppercase; letter-spacing: .04em; }
  .cell .v { font-size: 16px; font-weight: 700; margin-top: 2px; }
  h3 { font-size: 14px; margin: 18px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border-bottom: 1px solid #e5e7eb; padding: 5px 6px; text-align: left; }
  th { background: #f3f4f6; }
  .sheet { break-before: page; page-break-before: always; }
  .sheet h2 { font-size: 14px; margin: 0 0 8px; }
  .drawing svg { width: 100%; height: auto; max-height: 250mm; }
  footer { margin-top: 20px; font-size: 11px; color: #6b7280; }
  @media print { .bar { display: none; } body { padding: 0; } }
</style></head><body>
  <div class="bar"><span>${esc(t('rep.hint'))}</span><button onclick="window.print()">${esc(t('rep.print'))}</button></div>
  <header>
    <div><div class="brand">◧ Tasvir AI</div><h1>${esc(t('rep.title'))}</h1></div>
    <div class="meta">${esc(t('rep.file'))}: ${esc(input.fileName || '—')}<br />${esc(t('rep.date'))}: ${esc(date)}</div>
  </header>
  <div class="grid">${rows.map(([k, v]) => `<div class="cell"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('')}</div>
  <h3>${esc(t('rep.partsList'))}</h3>
  <table><thead><tr><th>#</th><th>${esc(t('rep.colPart'))}</th><th>${esc(t('rep.colSize'))}</th><th>${esc(t('rep.colQty'))}</th></tr></thead><tbody>${partRows}</tbody></table>
  ${sheetPages.join('')}
  <footer>Tasvir AI · tasvirai.uz</footer>
  <script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 300); });</script>
</body></html>`);
  win.document.close();
}
