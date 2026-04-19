import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { groupIntoLines, xAtOffset } from './line-grouping.js';
import type { DataType, Placeholder } from './types.js';

function toCamelKey(label: string): string {
  const cleaned = label
    .replace(/['\u2018\u2019]/g, '')   // strip straight + curly apostrophes
    .replace(/[()/\-]/g, ' ')           // treat as word separators
    .replace(/[,:.]/g, '');             // strip sentence punctuation
  const words = cleaned.split(/\s+/).filter(Boolean);
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      return i === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}

function inferDataType(key: string): DataType {
  const k = key.toLowerCase();
  if (/\b(sex|gender|status|qualified)\b/.test(k)) return 'enum';
  if (/\b(date|maturity|birthday|dob|issued?|expiry|expiration)\b/.test(k)) return 'date';
  if (/\byear\b/.test(k)) return 'year';
  if (/\b(percent|percentage)\b|%/.test(k)) return 'percentage';
  if (/\b(value|amount|price|cost|fee|balance|premium|payment|salary)\b|\$/.test(k)) return 'currency';
  if (/\b(rate|factor|multiplier|ratio)\b/.test(k)) return 'float';
  if (/\b(number|age|count|qty|quantity)\b|#/.test(k)) return 'number';
  return 'string';
}

export async function findPlaceholders(pdfBytes: Uint8Array): Promise<Placeholder[]> {
  // pdfjs transfers/detaches the buffer it receives — hand it a copy.
  const copy = new Uint8Array(pdfBytes.byteLength);
  copy.set(pdfBytes);
  const doc = await getDocument({ data: copy }).promise;
  const placeholders: Placeholder[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    const styles = textContent.styles as Record<
      string,
      { fontFamily?: string; ascent?: number; descent?: number }
    >;

    const lines = groupIntoLines(textContent.items as any[]);

    for (const line of lines) {
      const regex = /\[([^\]\n]+)\]/g;
      let match: RegExpExecArray | null;
      let lastEnd = 0;
      while ((match = regex.exec(line.text)) !== null) {
        const startIdx = match.index;
        const endIdx = match.index + match[0].length;

        const labelText = line.text.slice(lastEnd, startIdx);
        const trailingMatch = /[.\u2026\s]*$/u.exec(labelText);
        const trailingLen = trailingMatch ? trailingMatch[0].length : 0;
        const label = labelText.slice(0, labelText.length - trailingLen).trim();
        if (!label) { lastEnd = endIdx; continue; }

        const dotsStartIdx = lastEnd + labelText.length - trailingLen;

        const xAt = (charIdx: number): { x: number; item: any } => {
          for (const r of line.ranges) {
            if (charIdx >= r.start && charIdx <= r.end) {
              return { x: xAtOffset(r.item, charIdx - r.start), item: r.item };
            }
          }
          const last = line.ranges[line.ranges.length - 1];
          return { x: last.item.transform[4] + last.item.width, item: last.item };
        };

        const bStart = xAt(startIdx);
        const bEnd = xAt(endIdx);
        const dStart = xAt(dotsStartIdx);

        const t = bStart.item.transform as number[];
        const fontSize = Math.hypot(t[2], t[3]) || bStart.item.height || 12;
        const style = styles[bStart.item.fontName] ?? {};
        const ascent = (style.ascent ?? 0.8) * fontSize;
        const descent = Math.abs(style.descent ?? -0.2) * fontSize;

        placeholders.push({
          page: i,
          key: toCamelKey(label),
          label,
          dataType: inferDataType(label),
          x: bStart.x,
          y: line.y,
          width: bEnd.x - bStart.x,
          dotsX: dStart.x,
          dotsWidth: Math.max(0, bStart.x - dStart.x),
          fontSize,
          ascent,
          descent,
          fontFamily: style.fontFamily ?? '',
        });

        lastEnd = endIdx;
      }
    }
  }

  return placeholders;
}
