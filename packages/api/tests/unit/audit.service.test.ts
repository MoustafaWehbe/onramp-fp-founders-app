jest.mock("../../src/db/prisma", () => ({
  prisma: {
    auditLog: {
      count: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
  },
}));

import { prisma } from "../../src/db/prisma";
import { auditService } from "../../src/services/audit.service";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const STARTUP_ID = "00000000-0000-0000-0000-000000000002";

beforeEach(() => jest.clearAllMocks());

describe("AuditService", () => {
  it("lists serialized logs with pagination meta", async () => {
    mockPrisma.auditLog.count.mockResolvedValue(1);
    mockPrisma.auditLog.findMany.mockResolvedValue([
      {
        id: "log-1",
        startupId: STARTUP_ID,
        action: "create",
        entityType: "document",
        entityId: "doc-1",
        changes: { title: "Pitch" },
        ipAddress: "127.0.0.1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        user: { id: "u1", firstName: "Mo", lastName: "H", email: "mo@example.com" },
      },
    ] as never);

    const result = await auditService.listLogs(STARTUP_ID, {
      page: 1,
      limit: 20,
    });

    expect(result.meta.total).toBe(1);
    expect(result.data[0].user.name).toBe("Mo H");
    expect(result.data[0].detail).toContain("Pitch");
  });

  it("exports csv rows", async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([
      {
        id: "log-1",
        startupId: STARTUP_ID,
        action: "create",
        entityType: "document",
        entityId: "doc-1",
        changes: { title: "Pitch, deck" },
        ipAddress: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        user: { id: "u1", firstName: "Mo", lastName: null, email: "mo@example.com" },
      },
    ] as never);

    const csv = await auditService.exportCsv(STARTUP_ID, {});
    expect(csv.split("\n")[0]).toContain("when,user,email");
    expect(csv).toContain("mo@example.com");
    expect(csv).toContain("Pitch, deck");
  });
});
