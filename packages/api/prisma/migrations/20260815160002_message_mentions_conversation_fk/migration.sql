-- AddForeignKey
ALTER TABLE "message_mentions" ADD CONSTRAINT "message_mentions_conversation_id_startup_id_fkey" FOREIGN KEY ("conversation_id", "startup_id") REFERENCES "conversations"("id", "startup_id") ON DELETE CASCADE ON UPDATE CASCADE;

