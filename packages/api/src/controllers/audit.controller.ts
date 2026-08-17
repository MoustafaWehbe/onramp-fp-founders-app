import { asyncHandler } from "../utils/errors";
import { auditService } from "../services/audit.service";
import type { ListAuditLogsQuery } from "../validators/audit.schemas";

export const auditController = {
  listLogs: asyncHandler(async (req, res) => {
    const result = await auditService.listLogs(
      req.params.startupId as string,
      req.query as unknown as ListAuditLogsQuery,
    );
    res.json(result);
  }),

  facets: asyncHandler(async (req, res) => {
    const result = await auditService.facets(req.params.startupId as string);
    res.json({ data: result });
  }),

  exportLogs: asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListAuditLogsQuery;
    const csv = await auditService.exportCsv(req.params.startupId as string, {
      search: query.search,
      entityType: query.entityType,
      action: query.action,
      from: query.from,
      to: query.to,
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="audit-log-${req.params.startupId}.csv"`,
    );
    res.status(200).send(csv);
  }),
};
