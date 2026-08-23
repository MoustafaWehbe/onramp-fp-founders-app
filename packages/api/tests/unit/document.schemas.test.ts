import {
  createUploadSessionSchema,
  createVersionUploadSchema,
  documentIdParamSchema,
  documentPageParamSchema,
  listDocumentsQuerySchema,
  updateDocumentSchema,
  versionParamSchema,
} from "../../src/validators/document.schemas";

const UUID = "00000000-0000-0000-0000-000000000001";
const DOC_ID = "00000000-0000-0000-0000-000000000002";
const VER_ID = "00000000-0000-0000-0000-000000000003";

describe("listDocumentsQuerySchema", () => {
  it("applies defaults", () => {
    const result = listDocumentsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
      expect(result.data.lifecycle).toBe("active");
    }
  });

  it("accepts search and documentType", () => {
    const result = listDocumentsQuerySchema.safeParse({
      search: "pitch",
      documentType: "pitch_deck",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid documentType", () => {
    expect(listDocumentsQuerySchema.safeParse({ documentType: "pptx" }).success).toBe(false);
  });

  it("accepts archived and all lifecycle views", () => {
    expect(listDocumentsQuerySchema.safeParse({ lifecycle: "archived" }).success).toBe(true);
    expect(listDocumentsQuerySchema.safeParse({ lifecycle: "all" }).success).toBe(true);
    expect(listDocumentsQuerySchema.safeParse({ lifecycle: "deleted" }).success).toBe(false);
  });
});

describe("createUploadSessionSchema", () => {
  const base = {
    title: "Seed pitch",
    documentType: "pitch_deck",
    originalFilename: "pitch.txt",
    mimeType: "text/plain",
    fileSize: 1200,
  };

  it("accepts a valid TXT upload session", () => {
    expect(createUploadSessionSchema.safeParse(base).success).toBe(true);
  });

  it("rejects unsupported mime types", () => {
    expect(
      createUploadSessionSchema.safeParse({ ...base, mimeType: "image/png" }).success,
    ).toBe(false);
  });

  it("rejects oversized files", () => {
    expect(
      createUploadSessionSchema.safeParse({ ...base, fileSize: 21 * 1024 * 1024 }).success,
    ).toBe(false);
  });

  it("rejects short titles", () => {
    expect(createUploadSessionSchema.safeParse({ ...base, title: "A" }).success).toBe(false);
  });
});

describe("createVersionUploadSchema", () => {
  it("accepts a valid version upload body", () => {
    expect(
      createVersionUploadSchema.safeParse({
        originalFilename: "cap.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        fileSize: 5000,
      }).success,
    ).toBe(true);
  });
});

describe("updateDocumentSchema", () => {
  it("requires at least one field", () => {
    expect(updateDocumentSchema.safeParse({}).success).toBe(false);
  });

  it("accepts title updates", () => {
    expect(updateDocumentSchema.safeParse({ title: "Updated deck" }).success).toBe(true);
  });
});

describe("document params", () => {
  it("accepts valid document params", () => {
    expect(
      documentIdParamSchema.safeParse({ startupId: UUID, documentId: DOC_ID }).success,
    ).toBe(true);
  });

  it("accepts valid version params", () => {
    expect(
      versionParamSchema.safeParse({
        startupId: UUID,
        documentId: DOC_ID,
        versionId: VER_ID,
      }).success,
    ).toBe(true);
  });

  it("coerces a bounded page number", () => {
    const result = documentPageParamSchema.safeParse({
      startupId: UUID,
      documentId: DOC_ID,
      versionId: VER_ID,
      pageNumber: "8",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.pageNumber).toBe(8);
    expect(
      documentPageParamSchema.safeParse({
        startupId: UUID,
        documentId: DOC_ID,
        versionId: VER_ID,
        pageNumber: "0",
      }).success,
    ).toBe(false);
  });
});
