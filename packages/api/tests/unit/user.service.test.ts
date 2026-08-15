import { UserService } from "../../src/services/user.service";
import { updateUserSchema } from "../../src/validators/user.schemas";

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn() },
  },
}));

import { prisma } from "../../src/db/prisma";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma = prisma as any;
const service = new UserService();

describe("updateUserSchema", () => {
  it("accepts names and a compact raster data URL", () => {
    const result = updateUserSchema.safeParse({
      firstName: "  Ada  ",
      lastName: "Lovelace",
      avatarUrl: "data:image/jpeg;base64,YXZhdGFy",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.firstName).toBe("Ada");
  });

  it("accepts an existing http avatar and null for removal", () => {
    expect(updateUserSchema.safeParse({ avatarUrl: "https://images.example.com/me.jpg" }).success).toBe(true);
    expect(updateUserSchema.safeParse({ avatarUrl: null }).success).toBe(true);
  });

  it("rejects SVG data, non-http URLs, and empty updates", () => {
    expect(updateUserSchema.safeParse({ avatarUrl: "data:image/svg+xml;base64,PHN2Zz4=" }).success).toBe(false);
    expect(updateUserSchema.safeParse({ avatarUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(updateUserSchema.safeParse({}).success).toBe(false);
  });
});

describe("UserService.updateProfile", () => {
  beforeEach(() => jest.clearAllMocks());

  it("updates only the authenticated user", async () => {
    const updated = {
      id: "user-1",
      email: "ada@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      avatarUrl: null,
    };
    mockPrisma.user.findUnique.mockResolvedValue({ id: "user-1" });
    mockPrisma.user.update.mockResolvedValue(updated);

    await expect(service.updateProfile("user-1", { firstName: "Ada" })).resolves.toEqual(updated);
    expect(mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "user-1" },
      data: { firstName: "Ada" },
    }));
  });

  it("returns NOT_FOUND when the user no longer exists", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(service.updateProfile("missing", { firstName: "Ada" })).rejects.toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
    });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});
