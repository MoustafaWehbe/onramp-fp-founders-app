import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";
import type { UpdateUserInput } from "../validators/user.schemas";

const USER_PROFILE_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
  emailVerifiedAt: true,
  lastActiveStartupId: true,
  createdAt: true,
} as const;

export class UserService {
  async updateProfile(userId: string, input: UpdateUserInput) {
    const existing = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!existing) throw createError("User not found", 404, "NOT_FOUND");

    return prisma.user.update({
      where: { id: userId },
      data: input,
      select: USER_PROFILE_SELECT,
    });
  }
}

export const userService = new UserService();
