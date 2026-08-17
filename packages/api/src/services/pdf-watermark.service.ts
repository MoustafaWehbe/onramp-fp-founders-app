import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

/**
 * Stamps the same "email · short link id · date" identity used on the
 * on-screen page watermark (see watermark.service.ts) directly into the PDF
 * that leaves the server on a download. Unlike the page watermark this isn't
 * cached — a download is a rare, explicit action, not a scrolled-through
 * re-fetch — so it's cheap to build fresh every time.
 */

const TILE_STEP_X = 220;
const TILE_STEP_Y = 140;
const FONT_SIZE = 14;
const OPACITY = 0.15;

export const pdfWatermarkService = {
  async watermarkPdf(buffer: Buffer, text: string): Promise<Buffer> {
    const pdfDoc = await PDFDocument.load(buffer);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const textWidth = font.widthOfTextAtSize(text, FONT_SIZE);

    for (const page of pdfDoc.getPages()) {
      const { width, height } = page.getSize();

      // Tile diagonally across the whole page so any crop still contains a
      // full instance of the text — same rationale as the sharp tile on the
      // screen watermark.
      for (let y = -TILE_STEP_Y; y < height + TILE_STEP_Y; y += TILE_STEP_Y) {
        for (let x = -textWidth; x < width + textWidth; x += TILE_STEP_X) {
          page.drawText(text, {
            x,
            y,
            size: FONT_SIZE,
            font,
            color: rgb(0, 0, 0),
            opacity: OPACITY,
            rotate: degrees(-30),
          });
        }
      }
    }

    const bytes = await pdfDoc.save();
    return Buffer.from(bytes);
  },
};
