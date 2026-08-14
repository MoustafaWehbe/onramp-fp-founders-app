-- AlterTable
ALTER TABLE "pipeline" ADD COLUMN     "investor_fit_score" INTEGER,
ADD COLUMN     "owner_id" TEXT,
ADD COLUMN     "priority" TEXT;

-- AlterTable
ALTER TABLE "pipeline_stage_events" ADD COLUMN     "reason" TEXT;

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "startup_id" TEXT NOT NULL,
    "pipeline_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "due_date" TIMESTAMP(3),
    "assignee_id" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_startup_id_pipeline_id_status_idx" ON "tasks"("startup_id", "pipeline_id", "status");

-- CreateIndex
CREATE INDEX "tasks_startup_id_status_due_date_idx" ON "tasks"("startup_id", "status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "startup_members_startup_id_id_key" ON "startup_members"("startup_id", "id");

-- AddForeignKey
ALTER TABLE "pipeline" ADD CONSTRAINT "pipeline_owner_id_startup_id_fkey" FOREIGN KEY ("owner_id", "startup_id") REFERENCES "startup_members"("id", "startup_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_startup_id_fkey" FOREIGN KEY ("startup_id") REFERENCES "startups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_pipeline_id_startup_id_fkey" FOREIGN KEY ("pipeline_id", "startup_id") REFERENCES "pipeline"("id", "startup_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_startup_id_fkey" FOREIGN KEY ("assignee_id", "startup_id") REFERENCES "startup_members"("id", "startup_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

