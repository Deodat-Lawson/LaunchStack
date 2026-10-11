ALTER TABLE "pdr_ai_v2_invite_codes" ALTER COLUMN "code" SET DATA TYPE varchar(64);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_invite_codes" ADD COLUMN "requires_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Links that already exist keep the behaviour they were shared with: they
-- needed approval unless their workspace's (now retired) join policy was open.
UPDATE "pdr_ai_v2_invite_codes" AS ic SET "requires_approval" = true
WHERE NOT EXISTS (
    SELECT 1 FROM "pdr_ai_v2_workspace_settings" AS ws
    WHERE ws."company_id" = ic."company_id" AND ws."join_policy" = 'open'
);
