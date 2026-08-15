import { createReadStream } from "fs";
import { userService } from "../services/user.service";
import { storageService } from "../services/storage.service";
import { asyncHandler } from "../utils/errors";
import type { UpdateUserInput } from "../validators/user.schemas";

export const userController = {
  updateMe: asyncHandler(async (req, res) => {
    const user = await userService.updateProfile(
      req.user!.userId,
      req.body as UpdateUserInput,
    );
    res.json({ data: user });
  }),

  uploadAvatar: asyncHandler(async (req, res) => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body);
    const contentType = (req.headers["content-type"] ?? "").split(";")[0]?.trim();
    const user = await userService.uploadAvatar(req.user!.userId, body, contentType || "");
    res.json({ data: user });
  }),

  removeAvatar: asyncHandler(async (req, res) => {
    const user = await userService.removeAvatar(req.user!.userId);
    res.json({ data: user });
  }),

  avatarFile: asyncHandler(async (req, res) => {
    const { fullPath, contentType } = storageService.resolveLocalAvatarFile(
      req.params.userId as string,
      req.params.filename as string,
    );
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    createReadStream(fullPath)
      .on("error", () => {
        if (!res.headersSent) {
          res.status(404).json({ error: { message: "Avatar not found", code: "OBJECT_NOT_FOUND" } });
        }
      })
      .pipe(res);
  }),
};
