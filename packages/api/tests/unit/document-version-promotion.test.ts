jest.mock("../../src/db/prisma", () => ({
  prisma: {
    documentVersion: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

import { prisma } from "../../src/db/prisma";
import { promoteNewestUsableDocumentVersion } from "../../src/services/document-version-promotion";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => {
  jest.clearAllMocks();
  (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn) => fn(mockPrisma));
});

describe("promoteNewestUsableDocumentVersion", () => {
  it("keeps the current version while no fully usable replacement exists", async () => {
    mockPrisma.documentVersion.findFirst.mockResolvedValue(null);

    await promoteNewestUsableDocumentVersion("doc-1");

    expect(mockPrisma.documentVersion.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.documentVersion.update).not.toHaveBeenCalled();
  });

  it("atomically promotes the newest version ready for both pipelines", async () => {
    mockPrisma.documentVersion.findFirst.mockResolvedValue({ id: "version-3", isCurrent: false } as never);

    await promoteNewestUsableDocumentVersion("doc-1");

    expect(mockPrisma.documentVersion.findFirst).toHaveBeenCalledWith({
      where: {
        documentId: "doc-1",
        processingStatus: "ready",
        renderStatus: { in: ["ready", "unsupported"] },
      },
      orderBy: { versionNumber: "desc" },
      select: { id: true, isCurrent: true },
    });
    expect(mockPrisma.documentVersion.updateMany).toHaveBeenCalledWith({
      where: { documentId: "doc-1", isCurrent: true, id: { not: "version-3" } },
      data: { isCurrent: false },
    });
    expect(mockPrisma.documentVersion.update).toHaveBeenCalledWith({
      where: { id: "version-3" },
      data: { isCurrent: true },
    });
  });
});
