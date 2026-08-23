import type { Job } from "bullmq";
import { JOB_NAMES } from "../job-names";
import { prisma } from "../../db/prisma";
import { rasterizePdf } from "../../services/pdf-rasterize";
import { storageService } from "../../services/storage.service";
import { isOfficeConvertible, officeConvertService } from "../../services/office-convert.service";
import { promoteNewestUsableDocumentVersion } from "../../services/document-version-promotion";

export interface DocumentRasterizeJobData {
  startupId: string;
  documentId: string;
  versionId: string;
}

/**
 * Renders a PDF version into per-page WebP images so the reviewer portal can
 * serve pages instead of the source file.
 *
 * Deliberately a separate queue from document-processing: rasterization is
 * CPU-bound and would otherwise starve text extraction and embeddings, which
 * are IO-bound and much more latency-sensitive for in-app AI features.
 */
export const documentRasterizeJob = {
  name: JOB_NAMES.documentRasterize,
  concurrency: 1,

  async process(job: Job<DocumentRasterizeJobData>): Promise<{ pageCount: number }> {
    const { startupId, documentId, versionId } = job.data;
    const version = await prisma.documentVersion.findUnique({ where: { id: versionId } });
    if (!version) return { pageCount: 0 };

    const isPdf = version.mimeType === "application/pdf";
    const isConvertible = isOfficeConvertible(version.mimeType);
    if (!isPdf && !isConvertible) {
      await prisma.documentVersion.update({
        where: { id: versionId },
        data: { renderStatus: "unsupported", renderError: null, pageCount: null },
      });
      await promoteNewestUsableDocumentVersion(version.documentId);
      return { pageCount: 0 };
    }

    try {
      await prisma.documentVersion.update({
        where: { id: versionId },
        data: { renderStatus: "rendering", renderError: null },
      });

      let buffer = await storageService.readObject(version.storageKey, version.storageProvider);
      const provider = storageService.currentProvider();

      // DOCX/PPTX get converted to PDF first (LibreOffice headless, only
      // available in the worker image — see Dockerfile.worker), then flow
      // through the exact same rasterizer as a native PDF upload.
      if (isConvertible) {
        buffer = await officeConvertService.convertToPdf(buffer, version.mimeType);
      }

      // Re-rendering a version replaces its pages wholesale; a partial set left
      // behind by a failed earlier run would otherwise show up as gaps.
      await prisma.documentPage.deleteMany({ where: { documentVersionId: versionId } });

      const { pageCount } = await rasterizePdf(buffer, async (page) => {
        const storageKey = storageService.buildPageKey(
          startupId,
          documentId,
          versionId,
          page.pageNumber,
          "pages",
        );
        const thumbStorageKey = storageService.buildPageKey(
          startupId,
          documentId,
          versionId,
          page.pageNumber,
          "thumbs",
        );

        await storageService.putObject(storageKey, page.view, "image/webp");
        await storageService.putObject(thumbStorageKey, page.thumb, "image/webp");

        await prisma.documentPage.create({
          data: {
            documentVersionId: versionId,
            pageNumber: page.pageNumber,
            width: page.width,
            height: page.height,
            storageKey,
            thumbStorageKey,
            storageProvider: provider,
            byteSize: page.view.length,
          },
        });
      });

      await prisma.documentVersion.update({
        where: { id: versionId },
        data: { renderStatus: "ready", renderError: null, pageCount },
      });
      await promoteNewestUsableDocumentVersion(version.documentId);

      return { pageCount };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Rasterization failed";
      await prisma.documentVersion.update({
        where: { id: versionId },
        data: { renderStatus: "failed", renderError: message.slice(0, 1000) },
      });
      throw err;
    }
  },
};
