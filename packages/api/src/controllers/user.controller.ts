import { userService } from "../services/user.service";
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
};
