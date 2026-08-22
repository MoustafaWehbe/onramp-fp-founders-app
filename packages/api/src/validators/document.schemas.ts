import { z } from "zod";
import { ACCEPTED_MIME_TYPES, MAX_UPLOAD_BYTES } from "../services/storage.service";

export const DOCUMENT_TYPES = [
  "pitch_deck",
  "financial_model",
  "cap_table",
  "term_sheet",
  "data_room",
  "other",
] as const;

const documentTypeEnum = z.enum(DOCUMENT_TYPES, {
  error: "Invalid document type",
});

const mimeEnum = z.enum(ACCEPTED_MIME_TYPES as unknown as [string, ...string[]], {
  error: "Unsupported file type. Allowed: PDF, DOCX, XLSX, PPTX, TXT",
});

export const listDocumentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional().transform((v) => v || undefined),
  documentType: documentTypeEnum.optional(),
});

export const createUploadSessionSchema = z.object({
  title: z.string().trim().min(2).max(200),
  documentType: documentTypeEnum,
  originalFilename: z.string().trim().min(1).max(255),
  mimeType: mimeEnum,
  fileSize: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  summary: z.string().trim().max(500).optional(),
});

export const createVersionUploadSchema = z.object({
  originalFilename: z.string().trim().min(1).max(255),
  mimeType: mimeEnum,
  fileSize: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  summary: z.string().trim().max(500).optional(),
});

export const documentIdParamSchema = z.object({
  startupId: z.string().guid(),
  documentId: z.string().guid(),
});

export const versionParamSchema = z.object({
  startupId: z.string().guid(),
  documentId: z.string().guid(),
  versionId: z.string().guid(),
});

export const updateDocumentSchema = z
  .object({
    title: z.string().trim().min(2).max(200).optional(),
    documentType: documentTypeEnum.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "At least one field is required" });

export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;
export type CreateUploadSessionInput = z.infer<typeof createUploadSessionSchema>;
export type CreateVersionUploadInput = z.infer<typeof createVersionUploadSchema>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;
