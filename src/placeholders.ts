import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, type PDFFont } from 'pdf-lib';
import { pickStandardFont, type StandardFontKey } from './fonts.js';
import { groupIntoLines } from './line-grouping.js';
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

  // Scratch pdf-lib doc purely for font-metric-based char position measurement.
  const measureDoc = await PDFDocument.create();
  const fontCache = new Map<StandardFontKey, PDFFont>();
  const getFont = async (family: string): Promise<PDFFont> => {
    const key = pickStandardFont(family);
    let f = fontCache.get(key);
    if (!f) {
      f = await measureDoc.embedFont(key);
      fontCache.set(key, f);
    }
    return f;
  };

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    const styles = textContent.styles as Record<
      string,
      { fontFamily?: string; ascent?: number; descent?: number }
    >;

    const lines = groupIntoLines(textContent.items as any[]);

    for (const line of lines) {
      // Two placeholder forms:
      //   [Label .... [Value]]  — wrapped row (e.g. optional joint owner
      //                           / joint annuitant sections). Label lives
      //                           inside the outer brackets.
      //   [Value]               — plain; label comes from preceding text.
      const regex = /\[([^\[\]\n]+?)[.\u2026\s]+\[([^\]\n]+)\]\]|\[([^\]\n]+)\]/g;
      let match: RegExpExecArray | null;
      let lastEnd = 0;
      while ((match = regex.exec(line.text)) !== null) {
        const wrapped = match[1] !== undefined;
        let startIdx: number;
        let endIdx: number;
        let dotsStartIdx: number;
        let label: string;
        let wrapperOpenIdx: number | null = null;
        let wrapperCloseIdx: number | null = null;

        if (wrapped) {
          const innerOpenIdx = match.index + match[0].lastIndexOf('[');
          const innerCloseIdx = match.index + match[0].length - 2;
          startIdx = innerOpenIdx;
          endIdx = innerCloseIdx + 1;
          dotsStartIdx = match.index + 1 + match[1].length;
          label = match[1].trim();
          wrapperOpenIdx = match.index;
          wrapperCloseIdx = match.index + match[0].length - 1;
        } else {
          startIdx = match.index;
          endIdx = match.index + match[0].length;
          const labelText = line.text.slice(lastEnd, startIdx);
          const trailingMatch = /[.\u2026\s]*$/u.exec(labelText);
          const trailingLen = trailingMatch ? trailingMatch[0].length : 0;
          label = labelText.slice(0, labelText.length - trailingLen).trim();
          dotsStartIdx = lastEnd + labelText.length - trailingLen;
        }

        if (!label) { lastEnd = endIdx; continue; }

        const xAt = async (charIdx: number): Promise<{ x: number; item: any }> => {
          for (const r of line.ranges) {
            if (charIdx >= r.start && charIdx <= r.end) {
              const item = r.item;
              const str = item.str as string;
              const offset = Math.max(0, Math.min(charIdx - r.start, str.length));
              const tx = item.transform[4] as number;
              if (offset === 0) return { x: tx, item };
              const fontSize = Math.hypot(item.transform[2], item.transform[3]) || item.height || 12;
              const style = styles[item.fontName] ?? {};
              const font = await getFont(style.fontFamily ?? '');
              const substr = str.substring(0, offset);
              const substrW = font.widthOfTextAtSize(substr, fontSize);
              const fullW = font.widthOfTextAtSize(str, fontSize);
              const scale = fullW > 0 ? item.width / fullW : 1;
              return { x: tx + substrW * scale, item };
            }
          }
          const last = line.ranges[line.ranges.length - 1];
          return { x: last.item.transform[4] + last.item.width, item: last.item };
        };

        const bStart = await xAt(startIdx);
        const bEnd = await xAt(endIdx);
        const dStart = await xAt(dotsStartIdx);

        const t = bStart.item.transform as number[];
        const fontSize = Math.hypot(t[2], t[3]) || bStart.item.height || 12;
        const style = styles[bStart.item.fontName] ?? {};
        const ascent = (style.ascent ?? 0.8) * fontSize;
        const descent = Math.abs(style.descent ?? -0.2) * fontSize;

        const placeholder: Placeholder = {
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
        };

        if (wrapperOpenIdx !== null && wrapperCloseIdx !== null) {
          const wOpen = await xAt(wrapperOpenIdx);
          const wOpenEnd = await xAt(wrapperOpenIdx + 1);
          const wClose = await xAt(wrapperCloseIdx);
          const wCloseEnd = await xAt(wrapperCloseIdx + 1);
          placeholder.wrapperOpenX = wOpen.x;
          placeholder.wrapperOpenWidth = wOpenEnd.x - wOpen.x;
          placeholder.wrapperCloseX = wClose.x;
          placeholder.wrapperCloseWidth = wCloseEnd.x - wClose.x;
        }

        placeholders.push(placeholder);

        lastEnd = endIdx;
      }
    }
  }

  return placeholders;
}
