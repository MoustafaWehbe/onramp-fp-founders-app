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

const mockPrisma = prisma as any;
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

  it("accepts a title-only update, trimmed, and treats an empty string as clearing it", () => {
    const result = updateUserSchema.safeParse({ title: "  Co-Founder & CEO  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.title).toBe("Co-Founder & CEO");

    const cleared = updateUserSchema.safeParse({ title: "" });
    expect(cleared.success).toBe(true);
    if (cleared.success) expect(cleared.data.title).toBeNull();
  });

  it("accepts an explicit null for title, the same as clearing it", () => {
    const result = updateUserSchema.safeParse({ title: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.title).toBeNull();
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

  it("updates the title used to sign AI-drafted emails", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "user-1" });
    mockPrisma.user.update.mockResolvedValue({
      id: "user-1",
      email: "ada@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      title: "Co-Founder & CEO",
      avatarUrl: null,
      avatarStorageKey: null,
    });

    const result = await service.updateProfile("user-1", { title: "Co-Founder & CEO" });

    expect(mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "user-1" },
      data: { title: "Co-Founder & CEO" },
    }));
    expect(result.title).toBe("Co-Founder & CEO");
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
