-- Serves list()'s per-workspace page/unreadCount (the common case) and the
-- cross-workspace fallback when no startupId scope is given.
CREATE INDEX "notifications_user_id_startup_id_created_at_idx" ON "notifications"("user_id", "startup_id", "created_at");
CREATE INDEX "notifications_user_id_startup_id_read_at_idx" ON "notifications"("user_id", "startup_id", "read_at");
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- Serves every dedup check in notification.service.ts (findFirst on this
-- exact tuple, optionally with a createdAt cooldown) and the batched
-- pre-filter queries in task-notifications.ts / pipeline-reminders.ts, which
-- filter the same tuple across many entities at once without a userId
-- predicate.
CREATE INDEX "notifications_entity_type_entity_id_type_created_at_idx" ON "notifications"("entity_type", "entity_id", "type", "created_at");
