import { rasterizePdf, type RasterizedPage } from "../../src/services/pdf-rasterize";
import sharp from "sharp";

/**
 * Builds a minimal multi-page PDF in memory rather than committing a binary
 * fixture, so the test stays readable and the page count is easy to vary.
 */
function buildPdf(pageTexts: string[]): Buffer {
  const objects: string[] = [];
  const pageObjNumbers: number[] = [];
  // 1 = catalog, 2 = pages tree, 3 = font; page/content objects follow.
  let next = 4;

  for (const text of pageTexts) {
    const contentNumber = next++;
    const pageNumber = next++;
    pageObjNumbers.push(pageNumber);
    const stream = `BT /F1 36 Tf 72 700 Td (${text}) Tj ET`;
    objects[contentNumber] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    objects[pageNumber] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNumber} 0 R >>`;
  }

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] =
    `<< /Type /Pages /Kids [${pageObjNumbers.map((n) => `${n} 0 R`).join(" ")}] ` +
    `/Count ${pageObjNumbers.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) {
    out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const WEBP_MAGIC = Buffer.from("WEBP", "ascii");

describe("rasterizePdf", () => {
  jest.setTimeout(60_000);

  it("renders every page to WebP with usable dimensions", async () => {
    const pages: RasterizedPage[] = [];
    const { pageCount } = await rasterizePdf(buildPdf(["Page One", "Page Two", "Page Three"]), async (page) => {
      pages.push(page);
    });

    expect(pageCount).toBe(3);
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);

    for (const page of pages) {
      // RIFF container: bytes 8-12 are the "WEBP" fourCC.
      expect(page.view.subarray(8, 12)).toEqual(WEBP_MAGIC);
      expect(page.thumb.subarray(8, 12)).toEqual(WEBP_MAGIC);
      expect(page.width).toBeGreaterThan(0);
      expect(page.height).toBeGreaterThan(0);
      // Portrait Letter must stay portrait, or the viewer's aspect-ratio boxes
      // would size every page wrongly.
      expect(page.height).toBeGreaterThan(page.width);
      expect(page.thumb.length).toBeLessThan(page.view.length);
    }
  });

  it("renders standard-font text rather than a blank page", async () => {
    const withText: RasterizedPage[] = [];
    await rasterizePdf(buildPdf(["Confidential Deck"]), async (p) => void withText.push(p));

    const blank: RasterizedPage[] = [];
    await rasterizePdf(buildPdf([" "]), async (p) => void blank.push(p));

    // pdf.js silently skips the 14 standard fonts when it cannot load their
    // data files, which turns a text page into an empty one. A blank white page
    // has no dark pixels, while a rendered text page must include some.
    const [textStats, blankStats] = await Promise.all([sharp(withText[0]!.view).stats(), sharp(blank[0]!.view).stats()]);
    expect(blankStats.channels[0]!.min).toBeGreaterThanOrEqual(250);
    expect(textStats.channels[0]!.min).toBeLessThan(blankStats.channels[0]!.min);
  });

  it("rejects a file that is not a readable PDF", async () => {
    await expect(
      rasterizePdf(Buffer.from("this is not a pdf"), async () => {}),
    ).rejects.toMatchObject({ code: "PDF_UNREADABLE" });
  });
});
