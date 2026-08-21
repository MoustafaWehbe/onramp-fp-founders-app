import type { Job } from "bullmq";
import { JOB_NAMES } from "../job-names";
import { aiAnalysisService } from "../../services/ai-analysis.service";

export interface AiAnalysisJobData { analysisId: string; }

export const aiAnalysisJob = {
  name: JOB_NAMES.aiAnalysis,
  concurrency: 2,
  async process(job: Job<AiAnalysisJobData>): Promise<void> {
    await aiAnalysisService.process(job.data.analysisId);
  },
};
