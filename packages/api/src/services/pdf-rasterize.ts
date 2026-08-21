import { createCanvas } from "@napi-rs/canvas";
import path from "path";
import sharp from "sharp";
import { createError } from "../utils/errors";

/**
 * Renders PDF pages to WebP images.
 *
 * This exists so the reviewer portal never has to hand a source file to an
 * external browser: reviewers are served these images, and the PDF itself stays
 * server-side. Everything downstream (watermarking, per-page access logging)
 * depends on the unit of delivery being a page image rather than a document.
 */

/** Rasterizing an unbounded page count is a denial of service on our own
 * worker. Decks are tens of pages; a 200-page data room is already an outlier. */
export const MAX_RASTER_PAGES = 200;

const VIEW_MAX_EDGE = 1600;
const THUMB_MAX_EDGE = 220;
const VIEW_QUALITY = 80;
const THUMB_QUALITY = 60;

/** Upper bound on the render scale. Without it, a poster-sized MediaBox would
 * allocate a canvas large enough to take the worker down. */
const MAX_RENDER_SCALE = 3;

export type RasterizedPage = {
  pageNumber: number;
  /** Dimensions of the encoded view image, not of the PDF page. */
  width: number;
  height: number;
  view: Buffer;
  thumb: Buffer;
};

// pdfjs-dist v4 ships ESM only, but this package compiles to CommonJS — so a
// plain `import()` would be emitted as `require()` and throw ERR_REQUIRE_ESM.
// `new Function` hides the import from TypeScript's module transform, leaving a
// genuine dynamic import at runtime.
const importEsm = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<PdfjsModule>;

type PdfjsModule = {
  getDocument: (options: Record<string, unknown>) => { promise: Promise<PdfDocument> };
};

type PdfDocument = {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
  destroy: () => Promise<void>;
};

type PdfPage = {
  getViewport: (options: { scale: number }) => { width: number; height: number };
  render: (options: { canvasContext: unknown; viewport: unknown }) => { promise: Promise<void> };
  cleanup: () => void;
};

let pdfjsPromise: Promise<PdfjsModule> | null = null;

function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= importEsm("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsPromise;
}

// pdf.js will not draw the 14 standard PDF fonts (Helvetica, Times, ...) unless
// it can load their data files, and it fails *silently* — the page renders with
// the text missing. These files ship inside pdfjs-dist; point at them on disk.
function pdfjsAssetPaths() {
  const root = path.dirname(require.resolve("pdfjs-dist/package.json"));
  return {
    standardFontDataUrl: path.join(root, "standard_fonts") + path.sep,
    cMapUrl: path.join(root, "cmaps") + path.sep,
  };
}

/** Scale that lands the page's longest edge near VIEW_MAX_EDGE, clamped so a
 * tiny page is not blown up and a huge one cannot exhaust memory. */
function renderScale(width: number, height: number) {
  const longest = Math.max(width, height);
  if (longest <= 0) return 1;
  return Math.min(MAX_RENDER_SCALE, Math.max(1, VIEW_MAX_EDGE / longest));
}

export async function openPdf(buffer: Buffer): Promise<{ doc: PdfDocument; pageCount: number }> {
  // Keep the ESM load outside the PDF_UNREADABLE mapping so Jest/runtime
  // failures (e.g. "Test environment has been torn down") are not reported as
  // a bad upload.
  const pdfjs = await loadPdfjs();
  let doc: PdfDocument;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      // Nothing in a reviewer-supplied PDF should be able to run script.
      isEvalSupported: false,
      // Ignore any embedded JS/interactive form actions entirely.
      disableAutoFetch: true,
      ...pdfjsAssetPaths(),
      cMapPacked: true,
    }).promise;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not read PDF";
    throw createError(`Could not read PDF: ${message}`, 422, "PDF_UNREADABLE");
  }

  if (doc.numPages > MAX_RASTER_PAGES) {
    await doc.destroy();
    throw createError(
      `This document has ${doc.numPages} pages. The limit for sharing is ${MAX_RASTER_PAGES}.`,
      422,
      "PDF_TOO_MANY_PAGES",
    );
  }

  return { doc, pageCount: doc.numPages };
}

/**
 * Renders pages one at a time and hands each to `onPage` before moving on, so
 * peak memory stays at roughly one page rather than the whole document.
 */
export async function rasterizePdf(
  buffer: Buffer,
  onPage: (page: RasterizedPage) => Promise<void>,
): Promise<{ pageCount: number }> {
  const { doc, pageCount } = await openPdf(buffer);

  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      try {
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: renderScale(base.width, base.height) });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const ctx = canvas.getContext("2d");

        // PDF pages are transparent where nothing is drawn; without this the
        // WebP would render as black on the viewer's dark theme.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({ canvasContext: ctx, viewport }).promise;
        const png = canvas.toBuffer("image/png");

        const view = await sharp(png)
          .resize({ width: VIEW_MAX_EDGE, height: VIEW_MAX_EDGE, fit: "inside", withoutEnlargement: true })
          .webp({ quality: VIEW_QUALITY })
          .toBuffer();
        const thumb = await sharp(png)
          .resize({ width: THUMB_MAX_EDGE, height: THUMB_MAX_EDGE, fit: "inside", withoutEnlargement: true })
          .webp({ quality: THUMB_QUALITY })
          .toBuffer();

        const meta = await sharp(view).metadata();

        await onPage({
          pageNumber,
          width: meta.width ?? canvas.width,
          height: meta.height ?? canvas.height,
          view,
          thumb,
        });
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await doc.destroy();
  }

  return { pageCount };
}
