import { z } from "zod";
import { TASK_STATUSES, PRIORITIES } from "../config/crm";

const taskStatusEnum = z.enum(TASK_STATUSES, {
  errorMap: () => ({ message: "Invalid task status" }),
});

const taskPriorityEnum = z.enum(PRIORITIES, {
  errorMap: () => ({ message: "Invalid priority" }),
});

function optionalText(max: number, label: string) {
  return z
    .union([z.string().trim().max(max, `${label} must be at most ${max} characters`), z.null()])
    .transform((value) => (value === null || value === "" ? null : value))
    .optional();
}

// z.coerce.date() runs `new Date(input)` on whatever it's given — null, false,
// and 0 all coerce to the 1970 epoch instead of failing. Only strings and Date
// instances are legitimate wire representations of a datetime, so anything
// else is forced to NaN first, which z.coerce.date() reliably rejects.
function coercedDate(label: string) {
  return z.preprocess(
    (value) => (typeof value === "string" || value instanceof Date ? value : NaN),
    z.coerce.date({ invalid_type_error: `${label} must be a valid datetime` }),
  );
}

const optionalDatetime = z
  .union([z.null(), coercedDate("dueDate")])
  .transform((value) => (value === null ? null : value))
  .optional();

export const createTaskSchema = z.object({
  pipelineId: z.string().uuid("pipelineId must be a valid UUID"),
  title: z.string().trim().min(1, "Title is required").max(200, "Title must be at most 200 characters"),
  description: optionalText(2000, "Description"),
  priority: taskPriorityEnum.optional(),
  dueDate: optionalDatetime,
  assigneeId: z.string().uuid("assigneeId must be a valid UUID").nullable().optional(),
});

export const updateTaskSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Title is required")
      .max(200, "Title must be at most 200 characters")
      .optional(),
    description: optionalText(2000, "Description"),
    status: taskStatusEnum.optional(),
    priority: taskPriorityEnum.optional(),
    dueDate: optionalDatetime,
    assigneeId: z.string().uuid("assigneeId must be a valid UUID").nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

export const listTaskQuerySchema = z.object({
  pipelineId: z.string().uuid("pipelineId must be a valid UUID").optional(),
  // Every task on every deal in one raise — what a cross-deal "my work" view
  // needs, without the client fetching each deal's list separately.
  roundId: z.string().uuid("roundId must be a valid UUID").optional(),
  status: taskStatusEnum.optional(),
  assigneeId: z.string().uuid("assigneeId must be a valid UUID").optional(),
  priority: taskPriorityEnum.optional(),
  page: z.coerce.number().int().min(1, "page must be at least 1").default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, "limit must be at least 1")
    .max(100, "limit must be at most 100")
    .default(20),
});

export const taskIdParamSchema = z.object({
  startupId: z.string().uuid("startupId must be a valid UUID"),
  taskId: z.string().uuid("taskId must be a valid UUID"),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ListTaskQuery = z.infer<typeof listTaskQuerySchema>;
