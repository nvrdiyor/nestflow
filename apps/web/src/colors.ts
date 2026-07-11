/** Part colour palette — kept identical to the engine renderer so the exact
 * source geometry and the flattened fallback are coloured the same. */
export const PALETTE = [
  '#2563eb',
  '#16a34a',
  '#db2777',
  '#f59e0b',
  '#8b5cf6',
  '#0891b2',
  '#dc2626',
  '#65a30d',
  '#c026d3',
  '#0d9488',
];

export function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length] as string;
}
