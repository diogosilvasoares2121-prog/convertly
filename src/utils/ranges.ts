/**
 * Parses a human page selection such as "1-3, 5, 8-12" into zero-based indexes.
 * - Pages are 1-based in the input.
 * - "7-" means "7 to the end"; "-3" means "1 to 3".
 * Returns the flattened, de-duplicated pages plus the individual groups.
 */
export type RangeParseResult = { ok: true; pages: number[]; groups: number[][] } | { ok: false; invalid: string };

export function parsePageRanges(input: string, pageCount: number): RangeParseResult {
  const groups: number[][] = [];
  for (const raw of input.split(/[,;]+/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^(\d*)\s*[-–—]\s*(\d*)$/.exec(part);
    let from: number;
    let to: number;
    if (m) {
      if (!m[1] && !m[2]) return { ok: false, invalid: part };
      from = m[1] ? Number(m[1]) : 1;
      to = m[2] ? Number(m[2]) : pageCount;
    } else if (/^\d+$/.test(part)) {
      from = to = Number(part);
    } else {
      return { ok: false, invalid: part };
    }
    if (from < 1 || to < 1 || from > pageCount || to > pageCount) return { ok: false, invalid: part };
    const group: number[] = [];
    if (from <= to) for (let p = from; p <= to; p++) group.push(p - 1);
    else for (let p = from; p >= to; p--) group.push(p - 1);
    groups.push(group);
  }
  if (!groups.length) return { ok: false, invalid: '' };
  const seen = new Set<number>();
  const pages: number[] = [];
  for (const g of groups) {
    for (const p of g) {
      if (!seen.has(p)) {
        seen.add(p);
        pages.push(p);
      }
    }
  }
  return { ok: true, pages, groups };
}

/** Formats zero-based indexes as compact 1-based ranges: [0,1,2,4] → "1-3, 5". */
export function formatPageRanges(indexes: readonly number[]): string {
  const sorted = [...new Set(indexes)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i]!;
    let end = start;
    while (i + 1 < sorted.length && sorted[i + 1] === end + 1) end = sorted[++i]!;
    parts.push(start === end ? `${start + 1}` : `${start + 1}-${end + 1}`);
  }
  return parts.join(', ');
}

/** Splits [0..pageCount) into consecutive chunks of `size` pages. */
export function chunkPages(pageCount: number, size: number): number[][] {
  const out: number[][] = [];
  const step = Math.max(1, Math.floor(size));
  for (let i = 0; i < pageCount; i += step) {
    out.push(Array.from({ length: Math.min(step, pageCount - i) }, (_, k) => i + k));
  }
  return out;
}
