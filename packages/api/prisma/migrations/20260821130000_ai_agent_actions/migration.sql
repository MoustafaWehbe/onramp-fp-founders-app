-- CreateTable
CREATE TABLE "ai_agent_actions" (
    "id" TEXT NOT NULL,
    "startup_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "payload" JSONB NOT NULL,
    "resolved_payload" JSONB,
    "result_ref" JSONB,
    "error_code" TEXT,
    "approved_at" TIMESTAMP(3),
    "executed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_agent_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_agent_actions_startup_id_status_created_at_idx" ON "ai_agent_actions"("startup_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "ai_agent_actions_message_id_idx" ON "ai_agent_actions"("message_id");

-- AddForeignKey
ALTER TABLE "ai_agent_actions" ADD CONSTRAINT "ai_agent_actions_startup_id_fkey" FOREIGN KEY ("startup_id") REFERENCES "startups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_actions" ADD CONSTRAINT "ai_agent_actions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ai_chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_actions" ADD CONSTRAINT "ai_agent_actions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "ai_chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_actions" ADD CONSTRAINT "ai_agent_actions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
