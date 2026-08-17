import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";
import { storageService } from "./storage.service";
import type { UpdateUserInput } from "../validators/user.schemas";

const USER_PROFILE_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
  avatarStorageKey: true,
  emailVerifiedAt: true,
  lastActiveStartupId: true,
  createdAt: true,
} as const;

type RawUser = { avatarUrl: string | null; avatarStorageKey: string | null };

/** Resolves the served avatarUrl and drops the internal storage key never
 * let a raw storage key leak into an API response. */
function serializeUser<T extends RawUser>(user: T): Omit<T, "avatarStorageKey"> {
  const { avatarStorageKey, ...rest } = user;
  return { ...rest, avatarUrl: storageService.resolveAvatarUrl(avatarStorageKey, user.avatarUrl) };
}

export class UserService {
  async updateProfile(userId: string, input: UpdateUserInput) {
    const existing = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!existing) throw createError("User not found", 404, "NOT_FOUND");

    const updated = await prisma.user.update({
      where: { id: userId },
      data: input,
      select: USER_PROFILE_SELECT,
    });
    return serializeUser(updated);
  }

  async uploadAvatar(userId: string, buffer: Buffer, mimeType: string) {
    const existing = await prisma.user.findUnique({
      where: { id: userId },
      select: { avatarStorageKey: true },
    });
    if (!existing) throw createError("User not found", 404, "NOT_FOUND");

    const { storageKey } = await storageService.uploadAvatar(userId, buffer, mimeType);
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { avatarStorageKey: storageKey },
      select: USER_PROFILE_SELECT,
    });
    // Only after the new key is committed — deleting the old object first would
    // leave the user with no photo at all if the DB write then failed.
    await storageService.deleteAvatar(existing.avatarStorageKey);
    return serializeUser(updated);
  }

  async removeAvatar(userId: string) {
    const existing = await prisma.user.findUnique({
      where: { id: userId },
      select: { avatarStorageKey: true },
    });
    if (!existing) throw createError("User not found", 404, "NOT_FOUND");

    // Clears both sources removing a photo means no photo, regardless of
    // whether it came from an upload or from Google's picture claim.
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { avatarStorageKey: null, avatarUrl: null },
      select: USER_PROFILE_SELECT,
    });
    await storageService.deleteAvatar(existing.avatarStorageKey);
    return serializeUser(updated);
  }
}

export const userService = new UserService();
