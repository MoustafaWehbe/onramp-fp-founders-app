import { asyncHandler } from "../utils/errors";
import { startupService } from "../services/startup.service";
import type { CreateStartupInput, UpdateStartupInput } from "../validators/startup.schemas";
import type { CreateRoleInput, UpdateRoleInput } from "../validators/role.schemas";

export const startupController = {
  createStartup: asyncHandler(async (req, res) => {
    const result = await startupService.createStartup(
      req.body as CreateStartupInput,
      req.user!.userId,
    );
    res.status(201).json({ data: result });
  }),

  listMyStartups: asyncHandler(async (req, res) => {
    const startups = await startupService.listMyStartups(req.user!.userId);
    res.json({ data: { startups } });
  }),

  getStartup: asyncHandler(async (req, res) => {
    const result = await startupService.getStartup(req.params.startupId as string, req.user!.userId);
    res.json({ data: result });
  }),

  updateStartup: asyncHandler(async (req, res) => {
    const startup = await startupService.updateStartup(
      req.params.startupId as string,
      req.body as UpdateStartupInput,
    );
    res.json({ data: { startup } });
  }),

  deleteStartup: asyncHandler(async (req, res) => {
    await startupService.deleteStartup(req.params.startupId as string);
    res.status(204).send();
  }),

  activateStartup: asyncHandler(async (req, res) => {
    await startupService.setActiveStartup(req.params.startupId as string, req.user!.userId);
    res.status(204).send();
  }),

  listRoles: asyncHandler(async (req, res) => {
    const roles = await startupService.listRoles(req.params.startupId as string);
    res.json({ data: { roles } });
  }),

  createRole: asyncHandler(async (req, res) => {
    const role = await startupService.createRole(req.params.startupId as string, req.body as CreateRoleInput);
    res.status(201).json({ data: { role } });
  }),

  updateRole: asyncHandler(async (req, res) => {
    const role = await startupService.updateRole(
      req.params.startupId as string,
      req.params.roleId as string,
      req.body as UpdateRoleInput,
    );
    res.json({ data: { role } });
  }),

  deleteRole: asyncHandler(async (req, res) => {
    await startupService.deleteRole(req.params.startupId as string, req.params.roleId as string);
    res.status(204).send();
  }),

  listMembers: asyncHandler(async (req, res) => {
    const members = await startupService.listMembers(req.params.startupId as string);
    res.json({ data: { members } });
  }),
};
