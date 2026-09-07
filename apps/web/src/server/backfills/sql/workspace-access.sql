-- Bring pre-roles rows into the workspace-access vocabulary.
--
-- Only the membership row is read now — `users.role` and `users.status` are
-- legacy columns nothing consults — so anything the old columns still
-- expressed has to be moved onto the membership before it is lost:
--
--   1. accounts the legacy global status still marks `pending` get a
--      `pending` membership (approval stays meaningful per workspace);
--   2. memberships in the retired `editor` role become `member`;
--   3. join links minted as `employer` / `employee` (and, from an old bug,
--      `owner`) now hand out `admin` / `member` / `admin` — a join link never
--      mints an owner.
--
-- Idempotent: every statement's WHERE clause excludes rows it already fixed.
--
-- Twin of apps/web/src/server/backfills/workspace-access.ts

BEGIN;

UPDATE "pdr_ai_v2_user_company_memberships" m
   SET "status" = 'pending'
  FROM "pdr_ai_v2_users" u
 WHERE u."id" = m."user_id"
   AND u."status" = 'pending'
   AND m."status" = 'active';

UPDATE "pdr_ai_v2_user_company_memberships"
   SET "role" = 'member'
 WHERE "role" = 'editor';

UPDATE "pdr_ai_v2_invite_codes"
   SET "role" = CASE "role"
                  WHEN 'employer' THEN 'admin'
                  WHEN 'employee' THEN 'member'
                  WHEN 'owner' THEN 'admin'
                  ELSE "role"
                END
 WHERE "role" IN ('employer', 'employee', 'owner');

COMMIT;
