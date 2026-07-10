declare module 'opentype.js' {
  export interface PathCommand {
    type: 'M' | 'L' | 'C' | 'Q' | 'Z';
    x?: number;
    y?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
  }
  export interface Path {
    commands: PathCommand[];
  }
  export interface Glyph {
    advanceWidth: number;
    getPath(x: number, y: number, fontSize: number): Path;
  }
  export interface Font {
    unitsPerEm: number;
    tables: { os2?: { sCapHeight?: number } };
    charToGlyph(ch: string): Glyph;
    stringToGlyphs(s: string): Glyph[];
  }
  export function parse(buffer: ArrayBuffer): Font;
  const _default: { parse: typeof parse };
  export default _default;
}
