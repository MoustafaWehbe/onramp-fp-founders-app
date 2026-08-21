ALTER TABLE "ai_chat_sessions" ADD COLUMN "persona_id" TEXT;

ALTER TABLE "ai_chat_sessions"
  ADD CONSTRAINT "ai_chat_sessions_persona_id_fkey"
  FOREIGN KEY ("persona_id") REFERENCES "investor_personas"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ai_chat_sessions_persona_id_idx" ON "ai_chat_sessions"("persona_id");
