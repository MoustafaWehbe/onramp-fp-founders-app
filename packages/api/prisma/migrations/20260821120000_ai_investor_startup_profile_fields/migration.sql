-- AlterTable
ALTER TABLE "startup_investors" ADD COLUMN     "check_size_max" DECIMAL(65,30),
ADD COLUMN     "check_size_min" DECIMAL(65,30),
ADD COLUMN     "description" TEXT,
ADD COLUMN     "geography_focus" TEXT,
ADD COLUMN     "portfolio_highlights" TEXT,
ADD COLUMN     "warm_intro_path" TEXT;

-- AlterTable
ALTER TABLE "startups" ADD COLUMN     "business_model" TEXT,
ADD COLUMN     "competitive_edge" TEXT,
ADD COLUMN     "founded_at" TIMESTAMP(3),
ADD COLUMN     "headquarters" TEXT,
ADD COLUMN     "one_liner" TEXT,
ADD COLUMN     "problem_statement" TEXT,
ADD COLUMN     "solution_summary" TEXT,
ADD COLUMN     "target_market" TEXT,
ADD COLUMN     "team_summary" TEXT,
ADD COLUMN     "traction_summary" TEXT;
