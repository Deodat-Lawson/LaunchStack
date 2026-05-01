-- Multi-workspace support.
--
-- 1. Adds `slug` and `swatch` to `pdr_ai_v2_company` so workspaces have a
--    stable URL handle and a brand color the picker UI can render.
--
-- 2. Creates `pdr_ai_v2_user_company_memberships` — the join table that lets
--    a user belong to many companies. `users.company_id` stays as the user's
--    *default* workspace; the active workspace per request is derived from
--    this table via the `pdr_active_company` cookie.
--
-- 3. Backfills one membership per existing user (mapping their current
--    `users.role`) and a unique slug per existing company.
--
-- Safe to re-run: every statement is idempotent.

-- ---------------------------------------------------------------------------
-- 1. company.slug + company.swatch
-- ---------------------------------------------------------------------------

ALTER TABLE "pdr_ai_v2_company"
    ADD COLUMN IF NOT EXISTS "slug" varchar(64);

ALTER TABLE "pdr_ai_v2_company"
    ADD COLUMN IF NOT EXISTS "swatch" integer NOT NULL DEFAULT 1;

-- Backfill slug for any existing company that doesn't have one. We slugify
-- the name (lower, replace non-alnum with '-', collapse runs, trim '-') and
-- append a numeric suffix on collision.
DO $$
DECLARE
    c RECORD;
    base_slug TEXT;
    candidate TEXT;
    n INT;
BEGIN
    FOR c IN
        SELECT id, name FROM "pdr_ai_v2_company"
        WHERE slug IS NULL OR slug = ''
        ORDER BY id
    LOOP
        base_slug := lower(regexp_replace(c.name, '[^a-zA-Z0-9]+', '-', 'g'));
        base_slug := regexp_replace(base_slug, '(^-+|-+$)', '', 'g');
        IF base_slug = '' THEN
            base_slug := 'workspace';
        END IF;
        IF length(base_slug) > 60 THEN
            base_slug := substring(base_slug from 1 for 60);
        END IF;
        candidate := base_slug;
        n := 1;
        WHILE EXISTS (
            SELECT 1 FROM "pdr_ai_v2_company"
            WHERE slug = candidate AND id <> c.id
        ) LOOP
            n := n + 1;
            candidate := base_slug || '-' || n;
        END LOOP;
        UPDATE "pdr_ai_v2_company" SET slug = candidate WHERE id = c.id;
    END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "company_slug_unique_idx"
    ON "pdr_ai_v2_company" ("slug");

-- ---------------------------------------------------------------------------
-- 2. user_company_memberships
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "pdr_ai_v2_user_company_memberships" (
    "id" serial PRIMARY KEY,
    "user_id" bigint NOT NULL REFERENCES "pdr_ai_v2_users"("id") ON DELETE CASCADE,
    "company_id" bigint NOT NULL REFERENCES "pdr_ai_v2_company"("id") ON DELETE CASCADE,
    "role" varchar(16) NOT NULL,
    "last_opened_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_company_memberships_user_company_unique"
    ON "pdr_ai_v2_user_company_memberships" ("user_id", "company_id");
CREATE INDEX IF NOT EXISTS "user_company_memberships_user_id_idx"
    ON "pdr_ai_v2_user_company_memberships" ("user_id");
CREATE INDEX IF NOT EXISTS "user_company_memberships_company_id_idx"
    ON "pdr_ai_v2_user_company_memberships" ("company_id");

-- ---------------------------------------------------------------------------
-- 3. Backfill one membership per existing user
-- ---------------------------------------------------------------------------
-- Map legacy roles: 'employer' or 'owner' -> 'owner', everything else -> 'editor'.

INSERT INTO "pdr_ai_v2_user_company_memberships"
    ("user_id", "company_id", "role", "last_opened_at", "created_at")
SELECT
    u."id",
    u."company_id",
    CASE
        WHEN u."role" IN ('owner', 'employer') THEN 'owner'
        ELSE 'editor'
    END,
    COALESCE(u."last_active_at", u."created_at"),
    u."created_at"
FROM "pdr_ai_v2_users" u
WHERE u."company_id" IS NOT NULL
ON CONFLICT ("user_id", "company_id") DO NOTHING;
