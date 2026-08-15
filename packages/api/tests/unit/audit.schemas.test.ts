import { listAuditLogsQuerySchema } from "../../src/validators/audit.schemas";

describe("listAuditLogsQuerySchema", () => {
  it("applies defaults", () => {
    const result = listAuditLogsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    }
  });

  it("rejects limit over 100", () => {
    expect(listAuditLogsQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it("trims empty search to undefined", () => {
    const result = listAuditLogsQuerySchema.safeParse({ search: "  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.search).toBeUndefined();
  });
});
