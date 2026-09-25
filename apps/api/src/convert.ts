import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Server-side conversion of the formats a browser cannot read — PDF and
 * Illustrator, EPS / PostScript, CorelDRAW and AutoCAD DWG — into the SVG or
 * DXF the nesting app already imports at true size:
 *
 *   PDF, AI (PDF-based)   → pdftocairo -svg        (poppler)
 *   EPS, PS, old AI       → ghostscript → PDF → pdftocairo
 *   CDR (CorelDRAW)       → cdr2xhtml              (libcdr)
 *   DWG (AutoCAD)         → dwg2dxf                (LibreDWG)
 *
 * The tools run on untrusted uploads, so each call gets its own temp folder,
 * a hard timeout, no inherited secrets in the environment, and — when the
 * server runs as root in its container — the unprivileged `nobody` user.
 */

export type SourceKind = 'pdf' | 'ps' | 'cdr' | 'dwg';

export interface Converted {
  format: 'svg' | 'dxf';
  text: string;
  /** Pages in the source; only the first one is converted. */
  pages: number;
}

export type Converter = (input: Buffer, kind: SourceKind) => Promise<Converted>;

export class ConvertError extends Error {
  constructor(
    readonly code: 'failed' | 'unavailable',
    message: string,
  ) {
    super(message);
  }
}

/** Largest upload accepted for conversion. */
export const MAX_CONVERT_BYTES = 60 * 1024 * 1024;

/** Recognises a convertible file by its magic bytes (the extension only breaks ties). */
export function detectKind(name: string, data: Buffer): SourceKind | null {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
  const head = data.subarray(0, 1024).toString('latin1');
  if (head.startsWith('%PDF')) return 'pdf';
  if (head.startsWith('%!PS')) return 'ps';
  // DOS EPS binary header (C5 D0 D3 C6) wraps a PostScript section.
  if (data.length > 4 && data[0] === 0xc5 && data[1] === 0xd0 && data[2] === 0xd3 && data[3] === 0xc6) return 'ps';
  if (/^AC10\d\d/.test(head)) return 'dwg';
  // CorelDRAW: RIFF "CDR?" up to X3, a ZIP container from X4 on.
  if (head.startsWith('RIFF') && /^cdr/i.test(head.slice(8, 11))) return 'cdr';
  if (ext === 'cdr' && head.startsWith('PK\x03\x04')) return 'cdr';
  // Some PDFs carry a few junk bytes before the header.
  if ((ext === 'pdf' || ext === 'ai') && head.includes('%PDF-')) return 'pdf';
  return null;
}

const TIMEOUT_MS = 90_000;
const NOBODY = 65534;

function run(cmd: string, args: string[], cwd: string): Promise<string> {
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      {
        cwd,
        timeout: TIMEOUT_MS,
        killSignal: 'SIGKILL',
        maxBuffer: 200 * 1024 * 1024,
        encoding: 'utf8',
        // Only what the tools need — never the server's secrets.
        env: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: cwd, LC_ALL: 'C.UTF-8' },
        ...(asRoot ? { uid: NOBODY, gid: NOBODY } : {}),
      },
      (err, stdout) => {
        if (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === 'ENOENT') reject(new ConvertError('unavailable', `${cmd} is not installed`));
          else reject(new ConvertError('failed', `${cmd} failed`));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

async function pdfToSvg(dir: string, pdf: string): Promise<Converted> {
  let pages = 1;
  try {
    const info = await run('pdfinfo', [pdf], dir);
    pages = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1] ?? 1) || 1;
  } catch (err) {
    if (err instanceof ConvertError && err.code === 'unavailable') throw err;
    // An unreadable info block is not fatal — pdftocairo decides.
  }
  await run('pdftocairo', ['-svg', '-f', '1', '-l', '1', pdf, 'out.svg'], dir);
  return { format: 'svg', text: await readFile(join(dir, 'out.svg'), 'utf8'), pages };
}

/** First page of libcdr's XHTML as a standalone SVG document. */
export function svgFromCdrXhtml(xhtml: string): { svg: string; pages: number } | null {
  const pages = (xhtml.match(/<svg:svg[\s>]/g) ?? []).length;
  const start = xhtml.indexOf('<svg:svg');
  const end = xhtml.indexOf('</svg:svg>', start);
  if (start < 0 || end < 0) return null;
  let svg = xhtml.slice(start, end + '</svg:svg>'.length).replace(/<(\/?)svg:/g, '<$1');
  svg = svg.replace(/\sxmlns:svg="[^"]*"/g, '');
  if (!/^<svg[^>]*\sxmlns=/.test(svg)) svg = svg.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (svg.includes('xlink:') && !/^<svg[^>]*xmlns:xlink=/.test(svg)) {
    svg = svg.replace(/^<svg/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  }
  return { svg: `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`, pages: Math.max(1, pages) };
}

/** The real converter, backed by the command-line tools installed in the image. */
export const systemConverter: Converter = async (input, kind) => {
  const dir = await mkdtemp(join(tmpdir(), 'tasvir-conv-'));
  try {
    // The unprivileged tool user must be able to read the input and write output.
    await chmod(dir, 0o777);
    const src = join(dir, `in.${kind === 'ps' ? 'eps' : kind}`);
    await writeFile(src, input, { mode: 0o644 });
    switch (kind) {
      case 'pdf':
        return await pdfToSvg(dir, src);
      case 'ps': {
        await run('gs', ['-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dEPSCrop', '-sDEVICE=pdfwrite', '-o', 'mid.pdf', src], dir);
        return await pdfToSvg(dir, join(dir, 'mid.pdf'));
      }
      case 'cdr': {
        const xhtml = await run('cdr2xhtml', [src], dir);
        const page = svgFromCdrXhtml(xhtml);
        if (!page) throw new ConvertError('failed', 'no drawing found in the CorelDRAW file');
        return { format: 'svg', text: page.svg, pages: page.pages };
      }
      case 'dwg': {
        await run('dwg2dxf', ['-y', '-o', 'out.dxf', src], dir);
        return { format: 'dxf', text: await readFile(join(dir, 'out.dxf'), 'utf8'), pages: 1 };
      }
    }
  } catch (err) {
    if (err instanceof ConvertError) throw err;
    throw new ConvertError('failed', 'conversion failed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

/** At most `limit` conversions at once; a few more may wait, the rest are turned away. */
export class Gate {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  constructor(
    private readonly limit = 2,
    private readonly maxWaiting = 6,
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T | typeof Gate.BUSY> {
    if (this.active >= this.limit) {
      if (this.queue.length >= this.maxWaiting) return Gate.BUSY;
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }

  static readonly BUSY = Symbol('busy');
}
