import { PDFDocument, PDFFont, rgb } from 'pdf-lib';
import { pickStandardFont, type StandardFontKey } from './fonts.js';
import { findPlaceholders } from './placeholders.js';
import { wrapIntoLines } from './text-wrap.js';
import type { Placeholder } from './types.js';

export async function stampPdf(
  pdfBytes: Uint8Array,
  values: Record<string, string>,
  precomputed?: Placeholder[],
): Promise<Uint8Array> {
  const placeholders = precomputed ?? (await findPlaceholders(pdfBytes));
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();

  const fontCache = new Map<StandardFontKey, PDFFont>();
  const getFont = async (family: string) => {
    const key = pickStandardFont(family);
    let font = fontCache.get(key);
    if (!font) {
      font = await pdfDoc.embedFont(key);
      fontCache.set(key, font);
    }
    return font;
  };

  for (const p of placeholders) {
    const value = values[p.key];
    if (value === undefined) continue;
    const page = pages[p.page - 1];
    const font = await getFont(p.fontFamily);

    const height = p.ascent + p.descent;
    const textWidth = font.widthOfTextAtSize(value, p.fontSize);
    const expandedWidth = p.width + p.dotsWidth;

    // Always erase the original bracketed span.
    page.drawRectangle({
      x: p.x,
      y: p.y - p.descent,
      width: p.width,
      height,
      color: rgb(1, 1, 1),
    });

    if (textWidth <= p.width) {
      page.drawText(value, { x: p.x, y: p.y, size: p.fontSize, font, color: rgb(0, 0, 0) });
    } else if (textWidth <= expandedWidth) {
      // Erase just enough leader dots (from the right, adjacent to '[') to fit the text.
      const extraNeeded = textWidth - p.width;
      const eraseStartX = p.x - extraNeeded;
      page.drawRectangle({
        x: eraseStartX,
        y: p.y - p.descent,
        width: extraNeeded,
        height,
        color: rgb(1, 1, 1),
      });
      page.drawText(value, { x: eraseStartX, y: p.y, size: p.fontSize, font, color: rgb(0, 0, 0) });
    } else {
      // Even erasing all leader dots isn't enough — wrap. First line takes the full
      // expanded width (all dots erased); continuation lines align at dotsX.
      if (p.dotsWidth > 0) {
        page.drawRectangle({
          x: p.dotsX,
          y: p.y - p.descent,
          width: p.dotsWidth,
          height,
          color: rgb(1, 1, 1),
        });
      }
      const wrappedLines = wrapIntoLines(value, font, p.fontSize, expandedWidth);
      const lineHeight = p.fontSize * 1.2;
      for (let li = 0; li < wrappedLines.length; li++) {
        page.drawText(wrappedLines[li], {
          x: p.dotsX,
          y: p.y - li * lineHeight,
          size: p.fontSize,
          font,
          color: rgb(0, 0, 0),
        });
      }
    }
  }

  return await pdfDoc.save();
}
