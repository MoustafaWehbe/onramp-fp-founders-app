import { apiClient } from "./api-client";

export type SendInvestorEmailInput = {
  pipelineId?: string;
  subject: string;
  body: string;
};

export type SendInvestorEmailResult = {
  messageId: string;
  threadId: string;
  logCreated: boolean;
};

export async function sendInvestorEmail(
  startupId: string,
  investorId: string,
  input: SendInvestorEmailInput,
): Promise<SendInvestorEmailResult> {
  const { data } = await apiClient.post<{ data: SendInvestorEmailResult }>(
    `/startups/${startupId}/investors/${investorId}/send-email`,
    input,
  );
  return data.data;
}
