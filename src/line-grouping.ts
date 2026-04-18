import type { Line } from './types.js';

export function xAtOffset(item: any, charOffset: number): number {
  const tx = item.transform[4] as number;
  const str = item.str as string;
  if (!str || str.length === 0) return tx;
  const clamped = Math.max(0, Math.min(charOffset, str.length));
  return tx + (clamped / str.length) * item.width;
}

// Group pdfjs items into visual lines by baseline Y (more reliable than hasEOL).
export function groupIntoLines(items: any[], tolerance = 1): Line[] {
  const filtered = items.filter((it) => typeof it.str === 'string' && it.str.length > 0);
  const byY = [...filtered].sort((a, b) => b.transform[5] - a.transform[5]);
  const lines: Line[] = [];
  for (const it of byY) {
    const y = it.transform[5];
    let line = lines.find((l) => Math.abs(l.y - y) <= tolerance);
    if (!line) {
      line = { y, text: '', ranges: [] };
      lines.push(line);
    }
    line.ranges.push({ start: 0, end: 0, item: it });
  }
  for (const line of lines) {
    line.ranges.sort((a, b) => a.item.transform[4] - b.item.transform[4]);
    for (const r of line.ranges) {
      r.start = line.text.length;
      line.text += r.item.str;
      r.end = line.text.length;
    }
  }
  return lines;
}
