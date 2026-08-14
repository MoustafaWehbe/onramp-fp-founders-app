import { apiClient } from "./api-client";

export const TASK_STATUSES = ["open", "completed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Shared with Pipeline.priority — same three-level scale. */
export const PRIORITIES = ["low", "medium", "high"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export type Task = {
  id: string;
  startupId: string;
  pipelineId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  dueDate: string | null;
  /** StartupMember id, not a user id. */
  assigneeId: string | null;
  /** Set server-side when status becomes "completed"; cleared on reopen. */
  completedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type CreateTaskInput = {
  pipelineId: string;
  title: string;
  description?: string | null;
  priority?: Priority;
  dueDate?: string | null;
  assigneeId?: string | null;
};

export type UpdateTaskInput = Partial<Omit<CreateTaskInput, "pipelineId">> & {
  status?: TaskStatus;
};

export async function listTasks(
  startupId: string,
  params: {
    pipelineId?: string;
    /** Every task across every deal in one round. */
    roundId?: string;
    status?: TaskStatus;
    assigneeId?: string;
    priority?: Priority;
    page?: number;
    limit?: number;
  } = {},
) {
  const { data } = await apiClient.get<{ data: Task[]; meta: PaginationMeta }>(
    `/startups/${startupId}/tasks`,
    { params },
  );
  return data;
}

export async function createTask(startupId: string, input: CreateTaskInput) {
  const { data } = await apiClient.post<{ data: Task }>(`/startups/${startupId}/tasks`, input);
  return data.data;
}

export async function updateTask(startupId: string, taskId: string, input: UpdateTaskInput) {
  const { data } = await apiClient.patch<{ data: Task }>(
    `/startups/${startupId}/tasks/${taskId}`,
    input,
  );
  return data.data;
}

export async function deleteTask(startupId: string, taskId: string) {
  const { data } = await apiClient.delete<{ message: string }>(
    `/startups/${startupId}/tasks/${taskId}`,
  );
  return data;
}

/** Toggle helper: complete stamps status + lets the server derive completedAt; reopen clears both. */
export async function setTaskStatus(startupId: string, taskId: string, status: TaskStatus) {
  return updateTask(startupId, taskId, { status });
}
