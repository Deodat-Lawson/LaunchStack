CREATE TABLE "pdr_ai_v2_workspace_activity" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"actor_user_id" varchar(256) NOT NULL,
	"verb" varchar(32) NOT NULL,
	"target_type" varchar(16) NOT NULL,
	"target_id" varchar(64),
	"target_label" varchar(300) NOT NULL,
	"target_path" varchar(1024),
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_workspace_notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"recipient_user_id" varchar(256) NOT NULL,
	"actor_user_id" varchar(256) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"target_type" varchar(16) NOT NULL,
	"target_id" varchar(64) NOT NULL,
	"target_label" varchar(300) NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_workspace_session_grants" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"session_id" varchar(64) NOT NULL,
	"principal_type" varchar(16) NOT NULL,
	"principal_id" varchar(64) NOT NULL,
	"level" varchar(16) DEFAULT 'view' NOT NULL,
	"granted_by" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_workspace_session_user_state" (
	"session_id" varchar(64) NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"company_id" bigint NOT NULL,
	"pinned_at" timestamp with time zone,
	"pin_rank" double precision,
	"archived_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "pdr_ai_v2_workspace_session_user_state_session_id_user_id_pk" PRIMARY KEY("session_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_workspace_sessions" ADD COLUMN "shared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_workspace_sessions" ADD COLUMN "forked_from_session_id" varchar(64);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_workspace_activity" ADD CONSTRAINT "pdr_ai_v2_workspace_activity_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_workspace_notifications" ADD CONSTRAINT "pdr_ai_v2_workspace_notifications_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_workspace_session_grants" ADD CONSTRAINT "pdr_ai_v2_workspace_session_grants_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_workspace_session_grants" ADD CONSTRAINT "pdr_ai_v2_workspace_session_grants_session_id_pdr_ai_v2_workspace_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."pdr_ai_v2_workspace_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_workspace_session_user_state" ADD CONSTRAINT "pdr_ai_v2_workspace_session_user_state_session_id_pdr_ai_v2_workspace_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."pdr_ai_v2_workspace_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_workspace_session_user_state" ADD CONSTRAINT "pdr_ai_v2_workspace_session_user_state_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_activity_company_created_idx" ON "pdr_ai_v2_workspace_activity" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "workspace_activity_company_actor_idx" ON "pdr_ai_v2_workspace_activity" USING btree ("company_id","actor_user_id");--> statement-breakpoint
CREATE INDEX "workspace_notifications_recipient_created_idx" ON "pdr_ai_v2_workspace_notifications" USING btree ("company_id","recipient_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_session_grants_session_principal_uq" ON "pdr_ai_v2_workspace_session_grants" USING btree ("session_id","principal_type","principal_id");--> statement-breakpoint
CREATE INDEX "workspace_session_grants_company_principal_idx" ON "pdr_ai_v2_workspace_session_grants" USING btree ("company_id","principal_type","principal_id");--> statement-breakpoint
CREATE INDEX "workspace_session_user_state_company_user_idx" ON "pdr_ai_v2_workspace_session_user_state" USING btree ("company_id","user_id");--> statement-breakpoint
-- ADR-014 data: Owners and Admins no longer read past restrictions. Everything
-- restricted before this change keeps its admin audience through an explicit
-- manage grant to the owner and admin roles and to every custom role holding
-- folders.manage. The Gmail subtree was always meant to be private; it is skipped.
INSERT INTO "pdr_ai_v2_folder_grants" ("company_id", "category_id", "principal_type", "principal_id", "level", "granted_by")
SELECT fs."company_id", fs."category_id", 'role', r.slug, 'manage', 'system:adr-014'
FROM "pdr_ai_v2_folder_settings" fs
JOIN "pdr_ai_v2_category" c ON c."id" = fs."category_id"
CROSS JOIN LATERAL (
    SELECT 'owner'::varchar AS slug
    UNION ALL SELECT 'admin'::varchar
    UNION ALL
    SELECT wr."slug" FROM "pdr_ai_v2_workspace_roles" wr
    WHERE wr."company_id" = fs."company_id" AND 'folders.manage' = ANY (wr."permissions")
) r
WHERE c."name" <> 'Gmail' AND c."name" NOT LIKE 'Gmail/%'
ON CONFLICT ("category_id", "principal_type", "principal_id") DO UPDATE SET "level" = 'manage';
--> statement-breakpoint
INSERT INTO "pdr_ai_v2_document_grants" ("company_id", "document_id", "principal_type", "principal_id", "level", "granted_by")
SELECT ds."company_id", ds."document_id", 'role', r.slug, 'manage', 'system:adr-014'
FROM "pdr_ai_v2_document_settings" ds
JOIN "pdr_ai_v2_document" d ON d."id" = ds."document_id"
CROSS JOIN LATERAL (
    SELECT 'owner'::varchar AS slug
    UNION ALL SELECT 'admin'::varchar
    UNION ALL
    SELECT wr."slug" FROM "pdr_ai_v2_workspace_roles" wr
    WHERE wr."company_id" = ds."company_id" AND 'folders.manage' = ANY (wr."permissions")
) r
WHERE ds."restricted" = true
  AND d."category" <> 'Gmail' AND d."category" NOT LIKE 'Gmail/%'
ON CONFLICT ("document_id", "principal_type", "principal_id") DO UPDATE SET "level" = 'manage';
--> statement-breakpoint
-- Owner pins move to the per-person state table; newest pin first.
INSERT INTO "pdr_ai_v2_workspace_session_user_state" ("session_id", "user_id", "company_id", "pinned_at", "pin_rank")
SELECT s."id", s."user_id", s."company_id", s."updated_at", -extract(epoch FROM s."updated_at")
FROM "pdr_ai_v2_workspace_sessions" s
WHERE s."pinned" = true
ON CONFLICT ("session_id", "user_id") DO NOTHING;
