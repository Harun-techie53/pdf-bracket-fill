import { StandardFonts } from 'pdf-lib';

export type StandardFontKey = (typeof StandardFonts)[keyof typeof StandardFonts];

export function pickStandardFont(fontFamily: string | undefined): StandardFontKey {
  const f = (fontFamily ?? '').toLowerCase();
  const isBold = /bold|black|heavy/.test(f);
  const isItalic = /italic|oblique/.test(f);
  if (f.includes('times') || f.includes('serif')) {
    if (isBold && isItalic) return StandardFonts.TimesRomanBoldItalic;
    if (isBold) return StandardFonts.TimesRomanBold;
    if (isItalic) return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }
  if (f.includes('courier') || f.includes('mono')) {
    if (isBold && isItalic) return StandardFonts.CourierBoldOblique;
    if (isBold) return StandardFonts.CourierBold;
    if (isItalic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }
  if (isBold && isItalic) return StandardFonts.HelveticaBoldOblique;
  if (isBold) return StandardFonts.HelveticaBold;
  if (isItalic) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}
