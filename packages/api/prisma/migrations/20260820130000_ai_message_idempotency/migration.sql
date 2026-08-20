-- One client request creates exactly one user message and at most one linked
-- assistant response. Null client_request_id remains available for migrated
-- historical rows and server-originated messages.
ALTER TABLE "ai_chat_messages"
  ADD COLUMN "client_request_id" TEXT,
  ADD COLUMN "response_to_message_id" TEXT;

CREATE UNIQUE INDEX "ai_chat_messages_response_to_message_id_key"
  ON "ai_chat_messages"("response_to_message_id");
CREATE UNIQUE INDEX "ai_chat_messages_session_id_client_request_id_key"
  ON "ai_chat_messages"("session_id", "client_request_id");
