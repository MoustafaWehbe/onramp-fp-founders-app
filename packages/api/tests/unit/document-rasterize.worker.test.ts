jest.mock("../../src/db/prisma", () => ({
  prisma: {
    documentVersion: { findUnique: jest.fn(), update: jest.fn() },
    documentPage: { deleteMany: jest.fn(), create: jest.fn() },
  },
}));

jest.mock("../../src/services/storage.service", () => ({
  storageService: {
    readObject: jest.fn(),
    currentProvider: jest.fn(() => "local"),
    buildPageKey: jest.fn(
      (_startupId: string, _documentId: string, _versionId: string, page: number, kind: string) =>
        `key/${kind}/${page}.webp`,
    ),
    putObject: jest.fn(),
  },
}));

jest.mock("../../src/services/pdf-rasterize", () => ({
  rasterizePdf: jest.fn(),
}));

jest.mock("../../src/services/office-convert.service", () => ({
  isOfficeConvertible: jest.fn(
    (mime: string) =>
      mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ),
  officeConvertService: { convertToPdf: jest.fn() },
}));

jest.mock("../../src/services/document-version-promotion", () => ({
  promoteNewestUsableDocumentVersion: jest.fn(),
}));

import { prisma } from "../../src/db/prisma";
import { storageService } from "../../src/services/storage.service";
import { rasterizePdf } from "../../src/services/pdf-rasterize";
import { officeConvertService } from "../../src/services/office-convert.service";
import { documentRasterizeJob } from "../../src/jobs/workers/document-rasterize.worker";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const VERSION_ID = "00000000-0000-0000-0000-000000000030";

function job(overrides: Record<string, unknown> = {}) {
  return {
    data: { startupId: "startup-1", documentId: "doc-1", versionId: VERSION_ID, ...overrides },
  } as never;
}

beforeEach(() => jest.clearAllMocks());

describe("documentRasterizeJob", () => {
  it("marks XLSX as unsupported without touching storage or the converter", async () => {
    mockPrisma.documentVersion.findUnique.mockResolvedValue({
      id: VERSION_ID,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      storageKey: "key",
      storageProvider: "local",
    } as never);

    await documentRasterizeJob.process(job());

    expect(mockPrisma.documentVersion.update).toHaveBeenCalledWith({
      where: { id: VERSION_ID },
      data: { renderStatus: "unsupported", renderError: null, pageCount: null },
    });
    expect(storageService.readObject).not.toHaveBeenCalled();
    expect(officeConvertService.convertToPdf).not.toHaveBeenCalled();
  });

  it("rasterizes a PDF directly, without calling the office converter", async () => {
    mockPrisma.documentVersion.findUnique.mockResolvedValue({
      id: VERSION_ID,
      mimeType: "application/pdf",
      storageKey: "key",
      storageProvider: "local",
    } as never);
    (storageService.readObject as jest.Mock).mockResolvedValue(Buffer.from("%PDF-bytes"));
    (rasterizePdf as jest.Mock).mockImplementation(async (_buf, _onPage) => ({ pageCount: 3 }));

    const result = await documentRasterizeJob.process(job());

    expect(officeConvertService.convertToPdf).not.toHaveBeenCalled();
    expect(rasterizePdf).toHaveBeenCalledWith(Buffer.from("%PDF-bytes"), expect.any(Function));
    expect(result).toEqual({ pageCount: 3 });
    expect(mockPrisma.documentVersion.update).toHaveBeenLastCalledWith({
      where: { id: VERSION_ID },
      data: { renderStatus: "ready", renderError: null, pageCount: 3 },
    });
  });

  it("converts a DOCX to PDF before rasterizing", async () => {
    mockPrisma.documentVersion.findUnique.mockResolvedValue({
      id: VERSION_ID,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      storageKey: "key",
      storageProvider: "local",
    } as never);
    (storageService.readObject as jest.Mock).mockResolvedValue(Buffer.from("docx-bytes"));
    (officeConvertService.convertToPdf as jest.Mock).mockResolvedValue(Buffer.from("%PDF-converted"));
    (rasterizePdf as jest.Mock).mockImplementation(async (_buf, _onPage) => ({ pageCount: 5 }));

    const result = await documentRasterizeJob.process(job());

    expect(officeConvertService.convertToPdf).toHaveBeenCalledWith(
      Buffer.from("docx-bytes"),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(rasterizePdf).toHaveBeenCalledWith(Buffer.from("%PDF-converted"), expect.any(Function));
    expect(result).toEqual({ pageCount: 5 });
  });

  it("marks the version failed when conversion throws, without leaving it stuck on 'rendering'", async () => {
    mockPrisma.documentVersion.findUnique.mockResolvedValue({
      id: VERSION_ID,
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      storageKey: "key",
      storageProvider: "local",
    } as never);
    (storageService.readObject as jest.Mock).mockResolvedValue(Buffer.from("pptx-bytes"));
    (officeConvertService.convertToPdf as jest.Mock).mockRejectedValue(
      new Error("soffice exited with code 1"),
    );

    await expect(documentRasterizeJob.process(job())).rejects.toThrow("soffice exited with code 1");

    expect(mockPrisma.documentVersion.update).toHaveBeenLastCalledWith({
      where: { id: VERSION_ID },
      data: { renderStatus: "failed", renderError: "soffice exited with code 1" },
    });
    expect(rasterizePdf).not.toHaveBeenCalled();
  });
});
