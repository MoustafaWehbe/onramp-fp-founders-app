import type { Job } from "bullmq";
import { aiAnalysisService } from "../../services/ai-analysis.service";

export interface AiAnalysisJobData { analysisId: string; }

export const aiAnalysisJob = {
  name: "ai-analysis" as const,
  concurrency: 2,
  async process(job: Job<AiAnalysisJobData>): Promise<void> {
    await aiAnalysisService.process(job.data.analysisId);
  },
};
