-- Provision pdr_ai_v2_user_company_memberships for users who predate the table.
--
-- `resolveActiveCompanyForUser` resolves a verified user's workspace from
-- membership rows only, and `requireWorkspaceContext` refuses a context with
-- no membership — deliberately, so a membership miss can never fall back to
-- the legacy global `users.role`. Accounts created before the memberships
-- table existed have no such row, so without this backfill every product API
-- answers 403 for them and the workspace switcher offers nothing to pick.
--
-- The legacy pointer (`users.company_id`) and the legacy global role
-- (`users.role`) are the only evidence available for those accounts, so they
-- become the membership. Role vocabularies differ: `users.role` is
-- employer/employee, membership role is owner/admin/editor (see
-- src/lib/authz/permissions.ts), and the signup routes map employer→owner and
-- employee→editor — this mirrors that mapping.
--
-- Only verified users are provisioned: a pending user still resolves through
-- the `status = 'pending'` branch and must not hold workspace membership
-- before approval.
--
-- Idempotent: ON CONFLICT DO NOTHING, so an existing row (including a role
-- someone changed deliberately) is never rewritten by a re-run.
--
-- Twin of apps/web/src/server/backfills/user-company-memberships.ts

INSERT INTO "pdr_ai_v2_user_company_memberships" ("user_id", "company_id", "role")
SELECT
    u."id",
    u."company_id",
    CASE u."role"
        WHEN 'employer' THEN 'owner'
        WHEN 'owner' THEN 'owner'
        WHEN 'admin' THEN 'admin'
        ELSE 'editor'
    END
FROM "pdr_ai_v2_users" u
WHERE u."status" = 'verified'
  AND u."company_id" IS NOT NULL
ON CONFLICT ("user_id", "company_id") DO NOTHING;
