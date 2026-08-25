import { getRolePermissions, memberCan, requireAnyPermission, requireMember, requirePermission } from "../../src/middleware/rbac";
import { prisma } from "../../src/db/prisma";

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    startupMember: { findUnique: jest.fn() },
    rolePermission: { findFirst: jest.fn(), findMany: jest.fn() },
  },
}));

const mockFindUnique = prisma.startupMember.findUnique as jest.Mock;
const mockFindFirst = prisma.rolePermission.findFirst as jest.Mock;
const mockFindMany = prisma.rolePermission.findMany as jest.Mock;

/** Shapes a findMany row the way Prisma's `select: { permission: { select: {...} } }` returns it. */
function permissionRow(resource: string, action: string) {
  return { permission: { resource, action } };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    params: { startupId: "startup-1" },
    user: { userId: "user-1", email: "test@example.com", sessionId: "session-1" },
    member: undefined,
    ...overrides,
  } as any;
}

function makeRes() {
  const res = {} as any;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

/** Shapes a role the way requireMember's `include` returns it. */
function roleWith(...keys: string[]) {
  return {
    name: "custom",
    rolePermissions: keys.map((key) => {
      const [resource, action] = key.split(":");
      return permissionRow(resource!, action!);
    }),
  };
}

const ACTIVE_MEMBER = {
  id: "member-1",
  userId: "user-1",
  startupId: "startup-1",
  roleId: "role-1",
  status: "active",
  role: roleWith("startup:read", "pipeline:read"),
};

/** The req.member requireMember would have attached for the given grants. */
function memberContext(...keys: string[]) {
  return {
    id: "member-1",
    userId: "user-1",
    startupId: "startup-1",
    roleId: "role-1",
    roleName: "custom",
    status: "active",
    permissions: new Set(keys),
  };
}

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
      roleName: "custom",
      status: "active",
      permissions: new Set(["startup:read", "pipeline:read"]),
    });
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("queries prisma with the correct startupId and userId", async () => {
    mockFindUnique.mockResolvedValue(ACTIVE_MEMBER);

    await requireMember(makeReq(), res, next);

    // The role's grants ride along with the membership so no route gate ever
    // needs a second query, however many permissions it checks.
    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { startupId_userId: { startupId: "startup-1", userId: "user-1" } },
        include: expect.objectContaining({ role: expect.anything() }),
      }),
    );
  });

  it("calls next(err) on a database error", async () => {
    const dbError = new Error("DB connection failed");
    mockFindUnique.mockRejectedValue(dbError);

    await requireMember(makeReq(), res, next);

    expect(next).toHaveBeenCalledWith(dbError);
    expect(res.status).not.toHaveBeenCalled();
  });
});

// ─── requirePermission / requireAnyPermission ────────────────────────────────

describe("requirePermission", () => {
  let res: ReturnType<typeof makeRes>;
  let next: jest.Mock;

  beforeEach(() => {
    res = makeRes();
    next = jest.fn();
    jest.clearAllMocks();
  });

  it("returns 403 when the request has no member context at all", () => {
    requirePermission("startup", "read")(makeReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "FORBIDDEN" }));
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when the role does not hold the grant", () => {
    requirePermission("documents", "share")(makeReq({ member: memberContext("documents:read") }), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "FORBIDDEN" }));
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when the permission is granted", () => {
    requirePermission("startup", "read")(makeReq({ member: memberContext("startup:read") }), res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("enforces distinct resource+action pairs independently", () => {
    // Holding "team:read" must never satisfy a check for "team:delete".
    requirePermission("team", "delete")(makeReq({ member: memberContext("team:read") }), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("issues no database query of its own", () => {
    requirePermission("startup", "read")(makeReq({ member: memberContext("startup:read") }), res, next);

    // requireMember already resolved the whole grant set; a route carrying two
    // gates used to cost two extra round trips for the same answer.
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});

describe("requireAnyPermission", () => {
  let res: ReturnType<typeof makeRes>;
  let next: jest.Mock;

  beforeEach(() => {
    res = makeRes();
    next = jest.fn();
    jest.clearAllMocks();
  });

  it("passes on the stronger grant", () => {
    requireAnyPermission("financial:read", "pipeline:read")(makeReq({ member: memberContext("financial:read") }), res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it("passes on the weaker grant", () => {
    // The pipeline board needs the round list purely as a scope selector, so
    // pipeline:read alone reaches it; the handler redacts the amounts.
    requireAnyPermission("financial:read", "pipeline:read")(makeReq({ member: memberContext("pipeline:read") }), res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it("returns 403 when the role holds neither", () => {
    requireAnyPermission("financial:read", "pipeline:read")(makeReq({ member: memberContext("documents:read") }), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("memberCan", () => {
  it("reads a grant off the request requireMember resolved", () => {
    const req = makeReq({ member: memberContext("pipeline:read") });

    expect(memberCan(req, "pipeline", "read")).toBe(true);
    expect(memberCan(req, "financial", "read")).toBe(false);
  });

  it("is false when there is no member context", () => {
    expect(memberCan(makeReq(), "pipeline", "read")).toBe(false);
  });
});

describe("getRolePermissions", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns the role's grants as resource:action strings from a single query", async () => {
    mockFindMany.mockResolvedValue([permissionRow("startup", "read"), permissionRow("documents", "read")]);

    const permissions = await getRolePermissions("role-1");

    expect(mockFindMany).toHaveBeenCalledTimes(1);
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { roleId: "role-1" } }));
    expect(permissions.has("startup:read")).toBe(true);
    expect(permissions.has("documents:read")).toBe(true);
  });

  it("does not let one granted resource:action satisfy a lookup for a different one", async () => {
    // A role holding only "team:read" must not report "team:delete" as
    // granted the Set has to match on the full pair, not just the resource.
    mockFindMany.mockResolvedValue([permissionRow("team", "read")]);

    const permissions = await getRolePermissions("role-1");

    expect(permissions.has("team:delete")).toBe(false);
  });

  it("returns an empty set when the role has no permission rows", async () => {
    mockFindMany.mockResolvedValue([]);

    const permissions = await getRolePermissions("role-1");

    expect(permissions.size).toBe(0);
  });
});
