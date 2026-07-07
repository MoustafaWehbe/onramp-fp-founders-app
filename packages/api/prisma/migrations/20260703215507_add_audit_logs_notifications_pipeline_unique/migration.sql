/*
  Warnings:

  - You are about to drop the column `current_version_id` on the `documents` table. All the data in the column will be lost.
  - You are about to drop the column `target_id` on the `reviewer_comments` table. All the data in the column will be lost.
  - You are about to drop the column `target_type` on the `reviewer_comments` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[startup_id,id]` on the table `ai_analyses` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[document_version_id,chunk_index]` on the table `document_chunks` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[document_id,version_number]` on the table `document_versions` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[startup_id,id]` on the table `documents` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[startup_id,id]` on the table `fundraising_rounds` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[id,startup_investor_id]` on the table `pipeline` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[startup_id,id]` on the table `pipeline` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[startup_id,id]` on the table `startup_investors` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[invite_token_hash]` on the table `startup_members` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[startup_id,invited_email]` on the table `startup_members` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "ai_chat_sessions" DROP CONSTRAINT "ai_chat_sessions_analysis_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_chat_sessions" DROP CONSTRAINT "ai_chat_sessions_document_id_fkey";

-- DropForeignKey
ALTER TABLE "commitments" DROP CONSTRAINT "commitments_pipeline_id_fkey";

-- DropForeignKey
ALTER TABLE "commitments" DROP CONSTRAINT "commitments_round_id_fkey";

-- DropForeignKey
ALTER TABLE "commitments" DROP CONSTRAINT "commitments_startup_investor_id_fkey";

-- DropForeignKey
ALTER TABLE "documents" DROP CONSTRAINT "documents_current_version_id_fkey";

-- DropForeignKey
ALTER TABLE "interaction_logs" DROP CONSTRAINT "interaction_logs_pipeline_id_fkey";

-- DropForeignKey
ALTER TABLE "pipeline" DROP CONSTRAINT "pipeline_startup_investor_id_fkey";

-- AlterTable
ALTER TABLE "document_versions" ADD COLUMN     "is_current" BOOLEAN NOT NULL DEFAULT false;

-- Backfill is_current from documents.current_version_id before dropping the column
UPDATE "document_versions" dv
SET "is_current" = TRUE
FROM "documents" d
WHERE d."current_version_id" IS NOT NULL
  AND dv."id" = d."current_version_id";

-- Ensure only one "current" version per document
CREATE UNIQUE INDEX "document_versions_one_current_per_document_key"
ON "document_versions"("document_id")
WHERE "is_current" = TRUE;

-- AlterTable
ALTER TABLE "documents" DROP COLUMN "current_version_id";

-- AlterTable
ALTER TABLE "reviewer_comments"
ADD COLUMN     "chunk_id" TEXT,
ADD COLUMN     "document_id" TEXT;

-- Backfill new columns from legacy target fields (before dropping them)
UPDATE "reviewer_comments" SET "document_id" = "target_id" WHERE "target_type" = 'document';
UPDATE "reviewer_comments" SET "chunk_id" = "target_id" WHERE "target_type" = 'section';
UPDATE "reviewer_comments" rc
SET "document_id" = dv."document_id"
FROM "document_versions" dv
WHERE rc."target_type" = 'document_version'
  AND dv."id" = rc."target_id";

-- Drop legacy columns after backfill
ALTER TABLE "reviewer_comments" DROP COLUMN "target_id", DROP COLUMN "target_type";

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "startup_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "changes" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "startup_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_startup_id_entity_type_entity_id_idx" ON "audit_logs"("startup_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_startup_id_created_at_idx" ON "audit_logs"("startup_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_startup_id_created_at_idx" ON "notifications"("startup_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_analyses_startup_id_id_key" ON "ai_analyses"("startup_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "document_chunks_document_version_id_chunk_index_key" ON "document_chunks"("document_version_id", "chunk_index");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_document_id_version_number_key" ON "document_versions"("document_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "documents_startup_id_id_key" ON "documents"("startup_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "fundraising_rounds_startup_id_id_key" ON "fundraising_rounds"("startup_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_id_startup_investor_id_key" ON "pipeline"("id", "startup_investor_id");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_startup_id_id_key" ON "pipeline"("startup_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "startup_investors_startup_id_id_key" ON "startup_investors"("startup_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "startup_members_invite_token_hash_key" ON "startup_members"("invite_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "startup_members_startup_id_invited_email_key" ON "startup_members"("startup_id", "invited_email");

-- AddForeignKey
ALTER TABLE "reviewer_comments" ADD CONSTRAINT "reviewer_comments_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviewer_comments" ADD CONSTRAINT "reviewer_comments_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "document_chunks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline" ADD CONSTRAINT "pipeline_startup_investor_id_startup_id_fkey" FOREIGN KEY ("startup_investor_id", "startup_id") REFERENCES "startup_investors"("id", "startup_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interaction_logs" ADD CONSTRAINT "interaction_logs_pipeline_id_startup_investor_id_fkey" FOREIGN KEY ("pipeline_id", "startup_investor_id") REFERENCES "pipeline"("id", "startup_investor_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_startup_investor_id_startup_id_fkey" FOREIGN KEY ("startup_investor_id", "startup_id") REFERENCES "startup_investors"("id", "startup_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_pipeline_id_startup_id_fkey" FOREIGN KEY ("pipeline_id", "startup_id") REFERENCES "pipeline"("id", "startup_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_round_id_startup_id_fkey" FOREIGN KEY ("round_id", "startup_id") REFERENCES "fundraising_rounds"("id", "startup_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_chat_sessions" ADD CONSTRAINT "ai_chat_sessions_document_id_startup_id_fkey" FOREIGN KEY ("document_id", "startup_id") REFERENCES "documents"("id", "startup_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_chat_sessions" ADD CONSTRAINT "ai_chat_sessions_analysis_id_startup_id_fkey" FOREIGN KEY ("analysis_id", "startup_id") REFERENCES "ai_analyses"("id", "startup_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_startup_id_fkey" FOREIGN KEY ("startup_id") REFERENCES "startups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_startup_id_fkey" FOREIGN KEY ("startup_id") REFERENCES "startups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
