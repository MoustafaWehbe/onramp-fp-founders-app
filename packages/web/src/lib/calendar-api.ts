import { apiClient } from "./api-client";

export type MeetingType = "call" | "meeting";

export type ScheduleMeetingInput = {
  pipelineId?: string;
  type: MeetingType;
  /** ISO datetime string. */
  startDateTime: string;
  durationMinutes: number;
  subject?: string;
  description?: string;
};

export type ScheduleMeetingResult = {
  eventId: string;
  htmlLink: string;
  logCreated: boolean;
};

export async function scheduleMeeting(
  startupId: string,
  investorId: string,
  input: ScheduleMeetingInput,
): Promise<ScheduleMeetingResult> {
  const { data } = await apiClient.post<{ data: ScheduleMeetingResult }>(
    `/startups/${startupId}/investors/${investorId}/schedule-meeting`,
    input,
  );
  return data.data;
}
