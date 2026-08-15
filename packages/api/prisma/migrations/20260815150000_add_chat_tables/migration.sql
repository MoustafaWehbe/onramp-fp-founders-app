-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "startup_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "topic" TEXT,
    "last_message_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_members" (
    "id" TEXT NOT NULL,
    "startup_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "startup_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "sender_id" TEXT,
    "body" TEXT NOT NULL,
    "client_nonce" TEXT NOT NULL,
    "edited_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_startup_id_last_message_at_idx" ON "conversations"("startup_id", "last_message_at");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_startup_id_id_key" ON "conversations"("startup_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_startup_id_name_key" ON "conversations"("startup_id", "name");

-- CreateIndex
CREATE INDEX "conversation_members_member_id_startup_id_idx" ON "conversation_members"("member_id", "startup_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_members_conversation_id_member_id_key" ON "conversation_members"("conversation_id", "member_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_seq_idx" ON "messages"("conversation_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "messages_startup_id_id_key" ON "messages"("startup_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_conversation_id_client_nonce_key" ON "messages"("conversation_id", "client_nonce");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_startup_id_fkey" FOREIGN KEY ("startup_id") REFERENCES "startups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_startup_id_fkey" FOREIGN KEY ("conversation_id", "startup_id") REFERENCES "conversations"("id", "startup_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_member_id_startup_id_fkey" FOREIGN KEY ("member_id", "startup_id") REFERENCES "startup_members"("id", "startup_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_startup_id_fkey" FOREIGN KEY ("startup_id") REFERENCES "startups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_startup_id_fkey" FOREIGN KEY ("startup_id") REFERENCES "startups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_startup_id_fkey" FOREIGN KEY ("conversation_id", "startup_id") REFERENCES "conversations"("id", "startup_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_startup_id_fkey" FOREIGN KEY ("sender_id", "startup_id") REFERENCES "startup_members"("id", "startup_id") ON DELETE NO ACTION ON UPDATE CASCADE;

