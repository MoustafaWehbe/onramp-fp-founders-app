import { inviteMemberSchema, acceptInviteSchema, changeRoleSchema, memberIdParamSchema } from "../../src/validators/invite.schemas";

describe("inviteMemberSchema", () => {
  it("accepts a valid invite body", () => {
    const result = inviteMemberSchema.safeParse({
      email: "test@example.com",
      roleId: "00000000-0000-0000-0000-000000000001",
    });
    expect(result.success).toBe(true);
  });

  it("normalizes email to lowercase", () => {
    const result = inviteMemberSchema.safeParse({
      email: "TEST@Example.COM",
      roleId: "00000000-0000-0000-0000-000000000001",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("test@example.com");
    }
  });

  it("rejects an invalid email", () => {
    const result = inviteMemberSchema.safeParse({
      email: "not-an-email",
      roleId: "00000000-0000-0000-0000-000000000001",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing email", () => {
    const result = inviteMemberSchema.safeParse({
      roleId: "00000000-0000-0000-0000-000000000001",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing roleId", () => {
    const result = inviteMemberSchema.safeParse({
      email: "test@example.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-UUID roleId", () => {
    const result = inviteMemberSchema.safeParse({
      email: "test@example.com",
      roleId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty email", () => {
    const result = inviteMemberSchema.safeParse({
      email: "",
      roleId: "00000000-0000-0000-0000-000000000001",
    });
    expect(result.success).toBe(false);
  });
});

describe("acceptInviteSchema", () => {
  it("accepts a valid token", () => {
    const result = acceptInviteSchema.safeParse({ token: "abc123" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty token", () => {
    const result = acceptInviteSchema.safeParse({ token: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing token", () => {
    const result = acceptInviteSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("changeRoleSchema", () => {
  it("accepts a valid roleId", () => {
    const result = changeRoleSchema.safeParse({
      roleId: "00000000-0000-0000-0000-000000000001",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-UUID roleId", () => {
    const result = changeRoleSchema.safeParse({ roleId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing roleId", () => {
    const result = changeRoleSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("memberIdParamSchema", () => {
  it("accepts valid startupId and memberId", () => {
    const result = memberIdParamSchema.safeParse({
      startupId: "00000000-0000-0000-0000-000000000001",
      memberId: "00000000-0000-0000-0000-000000000002",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-UUID startupId", () => {
    const result = memberIdParamSchema.safeParse({
      startupId: "invalid",
      memberId: "00000000-0000-0000-0000-000000000002",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-UUID memberId", () => {
    const result = memberIdParamSchema.safeParse({
      startupId: "00000000-0000-0000-0000-000000000001",
      memberId: "invalid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing params", () => {
    const result = memberIdParamSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});