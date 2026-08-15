-- Adding the "chat" resource to config/permissions.ts is a data migration,
-- not just a code change: Role/RolePermission rows are created per startup at
-- seed/onboarding time, so an existing workspace never picks up a new
-- PERMISSIONS entry on its own. This inserts the three chat permissions and
-- grants them to every existing system role whose name matches a
-- ROLE_TEMPLATES key, mirroring what seed.ts's createRoles() does for a
-- brand-new workspace. ON CONFLICT DO NOTHING throughout so this is safe to
-- run against a database seed.ts has already populated (see the
-- skipDuplicates change alongside it).

INSERT INTO "permissions" ("id", "resource", "action", "description")
VALUES
  (gen_random_uuid(), 'chat', 'read', 'View conversations'),
  (gen_random_uuid(), 'chat', 'create', 'Post messages and create channels'),
  (gen_random_uuid(), 'chat', 'manage', 'Archive channels, remove any message')
ON CONFLICT ("resource", "action") DO NOTHING;

-- owner: every permission, including chat:manage.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid(), r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."resource" = 'chat'
WHERE r."name" = 'owner'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- collaborator and viewer: read + create, not manage matches
-- ROLE_TEMPLATES in config/permissions.ts.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid(), r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."resource" = 'chat' AND p."action" IN ('read', 'create')
WHERE r."name" IN ('collaborator', 'viewer')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
