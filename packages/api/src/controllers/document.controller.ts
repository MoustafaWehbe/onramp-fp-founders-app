import { asyncHandler } from "../utils/errors";
import { documentService } from "../services/document.service";
import { storageService } from "../services/storage.service";
import type {
  CreateUploadSessionInput,
  CreateVersionUploadInput,
  FileAccessQuery,
  ListDocumentsQuery,
  UpdateDocumentInput,
} from "../validators/document.schemas";
import { createReadStream } from "fs";
import path from "path";

export const documentController = {
  listDocuments: asyncHandler(async (req, res) => {
    const result = await documentService.listDocuments(
      req.params.startupId as string,
      req.query as unknown as ListDocumentsQuery,
    );
    res.json(result);
  }),

  getDocument: asyncHandler(async (req, res) => {
    const document = await documentService.getDocument(
      req.params.startupId as string,
      req.params.documentId as string,
    );
    res.json({ data: document });
  }),

  getAnalytics: asyncHandler(async (req, res) => {
    const result = await documentService.getDocumentAnalytics(
      req.params.startupId as string,
      req.params.documentId as string,
    );
    res.json({ data: result });
  }),

  createUploadSession: asyncHandler(async (req, res) => {
    const result = await documentService.createUploadSession(
      req.params.startupId as string,
      req.user!.userId,
      req.body as CreateUploadSessionInput,
    );
    res.status(201).json({ data: result });
  }),

  createVersionUploadSession: asyncHandler(async (req, res) => {
    const result = await documentService.createVersionUploadSession(
      req.params.startupId as string,
      req.params.documentId as string,
      req.user!.userId,
      req.body as CreateVersionUploadInput,
    );
    res.status(201).json({ data: result });
  }),

  confirmVersion: asyncHandler(async (req, res) => {
    const version = await documentService.confirmVersion(
      req.params.startupId as string,
      req.params.documentId as string,
      req.params.versionId as string,
    );
    res.json({ data: version });
  }),

  updateDocument: asyncHandler(async (req, res) => {
    const document = await documentService.updateDocument(
      req.params.startupId as string,
      req.params.documentId as string,
      req.body as UpdateDocumentInput,
    );
    res.json({ data: document });
  }),

  deleteDocument: asyncHandler(async (req, res) => {
    await documentService.deleteDocument(
      req.params.startupId as string,
      req.params.documentId as string,
      req.user!.userId,
    );
    res.status(204).send();
  }),

  getFileAccess: asyncHandler(async (req, res) => {
    const { versionId, disposition } = req.query as unknown as FileAccessQuery;
    const access = await documentService.getSignedReadUrl(
      req.params.startupId as string,
      req.params.documentId as string,
      req.user!.userId,
      versionId,
      disposition,
    );
    res.json({ data: access });
  }),

  localUpload: asyncHandler(async (req, res) => {
    const body = Buffer.isBuffer(req.body)
      ? req.body
      : await (async () => {
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          return Buffer.concat(chunks);
        })();
    await storageService.putLocalUpload(
      req.params.token as string,
      body,
      req.headers["content-type"],
    );
    res.status(204).send();
  }),

  localDownload: asyncHandler(async (req, res) => {
    const resolved = await storageService.resolveLocalDownload(req.params.token as string);
    const filename = resolved.originalFilename ?? path.basename(resolved.fullPath);
    const disposition = req.query.download === "1" ? "attachment" : "inline";
    res.setHeader("Content-Type", resolved.mimeType || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `${disposition}; filename="${filename.replace(/"/g, "")}"`,
    );
    createReadStream(resolved.fullPath)
      .on("error", (err) => {
        if (!res.headersSent) {
          res.status(404).json({ error: { message: "File not found", code: "OBJECT_NOT_FOUND" } });
        } else {
          res.destroy(err);
        }
      })
      .pipe(res);
  }),
};
