-- CreateTable
CREATE TABLE "message_mentions" (
    "id" TEXT NOT NULL,
    "startup_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "mentioned_member_id" TEXT,
    "investor_id" TEXT,
    "pipeline_id" TEXT,
    "task_id" TEXT,
    "round_id" TEXT,
    "document_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_mentions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_mentions_startup_id_target_type_pipeline_id_created_idx" ON "message_mentions"("startup_id", "target_type", "pipeline_id", "created_at");

-- CreateIndex
CREATE INDEX "message_mentions_startup_id_target_type_investor_id_created_idx" ON "message_mentions"("startup_id", "target_type", "investor_id", "created_at");

-- CreateIndex
CREATE INDEX "message_mentions_startup_id_target_type_task_id_created_at_idx" ON "message_mentions"("startup_id", "target_type", "task_id", "created_at");

-- CreateIndex
CREATE INDEX "message_mentions_startup_id_target_type_round_id_created_at_idx" ON "message_mentions"("startup_id", "target_type", "round_id", "created_at");

-- CreateIndex
CREATE INDEX "message_mentions_startup_id_target_type_document_id_created_idx" ON "message_mentions"("startup_id", "target_type", "document_id", "created_at");

-- CreateIndex
CREATE INDEX "message_mentions_startup_id_mentioned_member_id_created_at_idx" ON "message_mentions"("startup_id", "mentioned_member_id", "created_at");

-- CreateIndex
CREATE INDEX "message_mentions_message_id_idx" ON "message_mentions"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_startup_id_id_key" ON "tasks"("startup_id", "id");

-- AddForeignKey
ALTER TABLE "message_mentions" ADD CONSTRAINT "message_mentions_startup_id_fkey" FOREIGN KEY ("startup_id") REFERENCES "startups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_mentions" ADD CONSTRAINT "message_mentions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_mentions" ADD CONSTRAINT "message_mentions_mentioned_member_id_startup_id_fkey" FOREIGN KEY ("mentioned_member_id", "startup_id") REFERENCES "startup_members"("id", "startup_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_mentions" ADD CONSTRAINT "message_mentions_investor_id_startup_id_fkey" FOREIGN KEY ("investor_id", "startup_id") REFERENCES "startup_investors"("id", "startup_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_mentions" ADD CONSTRAINT "message_mentions_pipeline_id_startup_id_fkey" FOREIGN KEY ("pipeline_id", "startup_id") REFERENCES "pipeline"("id", "startup_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_mentions" ADD CONSTRAINT "message_mentions_task_id_startup_id_fkey" FOREIGN KEY ("task_id", "startup_id") REFERENCES "tasks"("id", "startup_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_mentions" ADD CONSTRAINT "message_mentions_round_id_startup_id_fkey" FOREIGN KEY ("round_id", "startup_id") REFERENCES "fundraising_rounds"("id", "startup_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_mentions" ADD CONSTRAINT "message_mentions_document_id_startup_id_fkey" FOREIGN KEY ("document_id", "startup_id") REFERENCES "documents"("id", "startup_id") ON DELETE CASCADE ON UPDATE CASCADE;

