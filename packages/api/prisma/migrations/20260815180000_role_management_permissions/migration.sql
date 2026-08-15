-- Adding "team:manage" and narrowing viewer's grants in config/permissions.ts is
-- a data migration, not just a code change: Role/RolePermission rows are created
-- per startup at seed/onboarding time, so an existing workspace never picks up a
-- catalog change on its own. This mirrors 20260815150001_chat_permissions:
-- insert the new permission, grant it to every existing "owner" role, and grant
-- "team:create" to every existing "collaborator" role so they can start
-- inviting viewers. Also revokes "financial:read" from "viewer" roles, since
-- viewers should never see rounds/commitments. ON CONFLICT / no-op DELETE
-- throughout so this is safe to run against a database seed.ts has already
-- populated.

INSERT INTO "permissions" ("id", "resource", "action", "description")
VALUES
  (gen_random_uuid(), 'team', 'manage', 'Create and edit roles and permission grants')
ON CONFLICT ("resource", "action") DO NOTHING;

-- owner: every permission, including team:manage.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid(), r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."resource" = 'team' AND p."action" = 'manage'
WHERE r."name" = 'owner'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- collaborator: gains team:create, so they can invite (viewer-only, enforced
-- in application code, not by the permission grant itself).
INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid(), r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."resource" = 'team' AND p."action" = 'create'
WHERE r."name" = 'collaborator'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- viewer: revoke financial:read — viewers must not see rounds or commitments.
DELETE FROM "role_permissions"
WHERE "role_id" IN (SELECT "id" FROM "roles" WHERE "name" = 'viewer')
  AND "permission_id" IN (
    SELECT "id" FROM "permissions" WHERE "resource" = 'financial' AND "action" = 'read'
  );
