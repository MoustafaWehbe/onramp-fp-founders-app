-- Self-uploaded profile photos now live in object storage instead of being
-- embedded as base64 data URLs in avatar_url. avatar_url is kept for the
-- external URL case (Google's picture claim); avatar_storage_key takes
-- priority over it whenever both are set. See User.avatarStorageKey in schema.prisma.
ALTER TABLE "users" ADD COLUMN "avatar_storage_key" TEXT;
