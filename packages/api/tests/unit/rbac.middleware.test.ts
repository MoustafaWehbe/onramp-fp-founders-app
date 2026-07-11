import { requireMember, requirePermission } from "../../src/middleware/rbac";
import { prisma } from "../../src/db/prisma";

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    startupMember: { findUnique: jest.fn() },
    rolePermission: { findFirst: jest.fn() },
  },
}));

const mockFindUnique = prisma.startupMember.findUnique as jest.Mock;
const mockFindFirst = prisma.rolePermission.findFirst as jest.Mock;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    params: { startupId: "startup-1" },
    user: { userId: "user-1", email: "test@example.com", sessionId: "session-1" },
    member: undefined,
    ...overrides,
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

function makeRes() {
  const res = {} as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const ACTIVE_MEMBER = {
  id: "member-1",
  userId: "user-1",
  startupId: "startup-1",
  roleId: "role-1",
  status: "active",
};

// ─── requireMember ────────────────────────────────────────────────────────────

describe("requireMember", () => {
  let res: ReturnType<typeof makeRes>;
  let next: jest.Mock;

  beforeEach(() => {
    res = makeRes();
    next = jest.fn();
    jest.clearAllMocks();
  });

  it("returns 400 when startupId param is missing", async () => {
    await requireMember(makeReq({ params: {} }), res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when no membership record exists", async () => {
    mockFindUnique.mockResolvedValue(null);

    await requireMember(makeReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "FORBIDDEN" }));
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when member status is pending", async () => {
    mockFindUnique.mockResolvedValue({ ...ACTIVE_MEMBER, status: "pending" });

    await requireMember(makeReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when member status is invited (non-active variant)", async () => {
    mockFindUnique.mockResolvedValue({ ...ACTIVE_MEMBER, status: "invited" });

    await requireMember(makeReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches req.member and calls next() when member is active", async () => {
    mockFindUnique.mockResolvedValue(ACTIVE_MEMBER);
    const req = makeReq();

    await requireMember(req, res, next);

    expect(req.member).toEqual({
      id: "member-1",
      userId: "user-1",
      startupId: "startup-1",
      roleId: "role-1",
      status: "active",
    });
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("queries prisma with the correct startupId and userId", async () => {
    mockFindUnique.mockResolvedValue(ACTIVE_MEMBER);

    await requireMember(makeReq(), res, next);

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: {
        startupId_userId: { startupId: "startup-1", userId: "user-1" },
      },
    });
  });

  it("calls next(err) on a database error", async () => {
    const dbError = new Error("DB connection failed");
    mockFindUnique.mockRejectedValue(dbError);

    await requireMember(makeReq(), res, next);

    expect(next).toHaveBeenCalledWith(dbError);
    expect(res.status).not.toHaveBeenCalled();
  });
});

// ─── requirePermission ────────────────────────────────────────────────────────

describe("requirePermission", () => {
  let res: ReturnType<typeof makeRes>;
  let next: jest.Mock;

  beforeEach(() => {
    res = makeRes();
    next = jest.fn();
    jest.clearAllMocks();
  });

  function makeAuthedReq() {
    return makeReq({ member: { ...ACTIVE_MEMBER } });
  }

  it("returns 403 when no matching role-permission row exists", async () => {
    mockFindFirst.mockResolvedValue(null);

    await requirePermission("startup", "read")(makeAuthedReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "FORBIDDEN" }));
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when the permission is granted", async () => {
    mockFindFirst.mockResolvedValue({
      id: "rp-1",
      roleId: "role-1",
      permissionId: "perm-1",
      permission: { id: "perm-1", resource: "startup", action: "read" },
    });

    await requirePermission("startup", "read")(makeAuthedReq(), res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("queries prisma with the correct roleId, resource, and action", async () => {
    mockFindFirst.mockResolvedValue(null);

    await requirePermission("documents", "share")(makeAuthedReq(), res, next);

    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          roleId: "role-1",
          permission: { resource: "documents", action: "share" },
        },
        include: { permission: true },
      }),
    );
  });

  it("enforces distinct resource+action pairs independently", async () => {
    mockFindFirst.mockResolvedValue(null);
    const req = makeAuthedReq();

    await requirePermission("team", "delete")(req, res, next);

    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { roleId: "role-1", permission: { resource: "team", action: "delete" } },
      }),
    );
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("calls next(err) on a database error", async () => {
    const dbError = new Error("Query failed");
    mockFindFirst.mockRejectedValue(dbError);

    await requirePermission("startup", "read")(makeAuthedReq(), res, next);

    expect(next).toHaveBeenCalledWith(dbError);
    expect(res.status).not.toHaveBeenCalled();
  });
});
