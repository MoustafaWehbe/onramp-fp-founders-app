CREATE INDEX "reviewer_sessions_invitation_id_verified_at_idx"
ON "reviewer_sessions"("invitation_id", "verified_at");

CREATE INDEX "reviewer_page_views_visit_id_first_viewed_at_idx"
ON "reviewer_page_views"("visit_id", "first_viewed_at");
