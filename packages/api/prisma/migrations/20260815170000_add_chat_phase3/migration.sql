-- AlterTable
ALTER TABLE "conversation_members" ADD COLUMN     "last_read_at" TIMESTAMP(3),
ADD COLUMN     "last_read_seq" BIGINT,
ADD COLUMN     "notify_level" TEXT NOT NULL DEFAULT 'all';

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "dm_key" TEXT,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'channel',
ALTER COLUMN "name" DROP NOT NULL;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "parent_message_id" TEXT,
ADD COLUMN     "reply_count" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "message_reactions" (
    "id" TEXT NOT NULL,
    "startup_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_attachments" (
    "id" TEXT NOT NULL,
    "startup_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_reactions_message_id_idx" ON "message_reactions"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_reactions_message_id_member_id_emoji_key" ON "message_reactions"("message_id", "member_id", "emoji");

-- CreateIndex
CREATE INDEX "message_attachments_message_id_idx" ON "message_attachments"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_attachments_message_id_document_id_key" ON "message_attachments"("message_id", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_startup_id_dm_key_key" ON "conversations"("startup_id", "dm_key");

-- CreateIndex
CREATE INDEX "messages_parent_message_id_seq_idx" ON "messages"("parent_message_id", "seq");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_parent_message_id_fkey" FOREIGN KEY ("parent_message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_startup_id_fkey" FOREIGN KEY ("startup_id") REFERENCES "startups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_member_id_startup_id_fkey" FOREIGN KEY ("member_id", "startup_id") REFERENCES "startup_members"("id", "startup_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_startup_id_fkey" FOREIGN KEY ("startup_id") REFERENCES "startups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_document_id_startup_id_fkey" FOREIGN KEY ("document_id", "startup_id") REFERENCES "documents"("id", "startup_id") ON DELETE CASCADE ON UPDATE CASCADE;

