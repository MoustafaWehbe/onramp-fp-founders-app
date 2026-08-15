import { UserService } from "../../src/services/user.service";
import { updateUserSchema } from "../../src/validators/user.schemas";

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn() },
  },
}));

jest.mock("../../src/services/storage.service", () => ({
  storageService: {
    resolveAvatarUrl: jest.fn((storageKey: string | null, fallbackUrl: string | null) =>
      storageKey ? `https://cdn.test/${storageKey}` : fallbackUrl,
    ),
    uploadAvatar: jest.fn(),
    deleteAvatar: jest.fn(),
  },
}));

import { prisma } from "../../src/db/prisma";
import { storageService } from "../../src/services/storage.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma = prisma as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockStorage = storageService as any;
const service = new UserService();

describe("updateUserSchema", () => {
  it("accepts a name-only update", () => {
    const result = updateUserSchema.safeParse({ firstName: "  Ada  ", lastName: "Lovelace" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.firstName).toBe("Ada");
  });

  it("accepts a single field on its own", () => {
    expect(updateUserSchema.safeParse({ firstName: "Ada" }).success).toBe(true);
    expect(updateUserSchema.safeParse({ lastName: "Lovelace" }).success).toBe(true);
  });

  it("rejects an empty update and blank names", () => {
    expect(updateUserSchema.safeParse({}).success).toBe(false);
    expect(updateUserSchema.safeParse({ firstName: "" }).success).toBe(false);
  });

  it("no longer accepts avatarUrl — that moved to PUT/DELETE /users/me/avatar", () => {
    const result = updateUserSchema.safeParse({ firstName: "Ada", avatarUrl: "https://images.example.com/me.jpg" });
    // Unknown keys are just stripped by default Zod object parsing, so this
    // still succeeds — the point is the value is silently dropped, not persisted.
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("avatarUrl");
  });
});

describe("UserService.updateProfile", () => {
  beforeEach(() => jest.clearAllMocks());

  it("updates only the authenticated user and resolves the served avatar URL", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "user-1" });
    mockPrisma.user.update.mockResolvedValue({
      id: "user-1",
      email: "ada@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      avatarUrl: null,
      avatarStorageKey: null,
    });

    const result = await service.updateProfile("user-1", { firstName: "Ada" });

    expect(mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "user-1" },
      data: { firstName: "Ada" },
    }));
    // avatarStorageKey is an internal detail — never returned to the client.
    expect(result).not.toHaveProperty("avatarStorageKey");
    expect(result.avatarUrl).toBeNull();
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

describe("UserService.uploadAvatar", () => {
  beforeEach(() => jest.clearAllMocks());

  it("stores the new key, resolves its served URL, and cleans up the old object", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ avatarStorageKey: "avatars/user-1/old.webp" });
    mockStorage.uploadAvatar.mockResolvedValue({ storageKey: "avatars/user-1/new.webp", url: "ignored" });
    mockPrisma.user.update.mockResolvedValue({
      id: "user-1",
      email: "ada@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      avatarUrl: null,
      avatarStorageKey: "avatars/user-1/new.webp",
    });

    const buffer = Buffer.from("fake-webp-bytes");
    const result = await service.uploadAvatar("user-1", buffer, "image/webp");

    expect(mockStorage.uploadAvatar).toHaveBeenCalledWith("user-1", buffer, "image/webp");
    expect(mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "user-1" },
      data: { avatarStorageKey: "avatars/user-1/new.webp" },
    }));
    // The old object is deleted only after the new key is committed — never before.
    expect(mockStorage.deleteAvatar).toHaveBeenCalledWith("avatars/user-1/old.webp");
    expect(result.avatarUrl).toBe("https://cdn.test/avatars/user-1/new.webp");
    expect(result).not.toHaveProperty("avatarStorageKey");
  });

  it("returns NOT_FOUND when the user no longer exists", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(service.uploadAvatar("missing", Buffer.from(""), "image/webp")).rejects.toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
    });
    expect(mockStorage.uploadAvatar).not.toHaveBeenCalled();
  });
});

describe("UserService.removeAvatar", () => {
  beforeEach(() => jest.clearAllMocks());

  it("clears both the storage key and any external avatarUrl, then deletes the old object", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ avatarStorageKey: "avatars/user-1/old.webp" });
    mockPrisma.user.update.mockResolvedValue({
      id: "user-1",
      email: "ada@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      avatarUrl: null,
      avatarStorageKey: null,
    });

    const result = await service.removeAvatar("user-1");

    expect(mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "user-1" },
      data: { avatarStorageKey: null, avatarUrl: null },
    }));
    expect(mockStorage.deleteAvatar).toHaveBeenCalledWith("avatars/user-1/old.webp");
    expect(result.avatarUrl).toBeNull();
  });
});
