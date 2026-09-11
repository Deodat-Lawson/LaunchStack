CREATE TABLE "pdr_ai_v2_document_grants" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"document_id" bigint NOT NULL,
	"principal_type" varchar(16) NOT NULL,
	"principal_id" varchar(64) NOT NULL,
	"level" varchar(16) NOT NULL,
	"granted_by" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_document_settings" (
	"document_id" bigint PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"restricted" boolean DEFAULT true NOT NULL,
	"updated_by" varchar(256) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_folder_grants" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"category_id" bigint NOT NULL,
	"principal_type" varchar(16) NOT NULL,
	"principal_id" varchar(64) NOT NULL,
	"level" varchar(16) NOT NULL,
	"granted_by" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_folder_settings" (
	"category_id" bigint PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"visibility" varchar(16) DEFAULT 'restricted' NOT NULL,
	"updated_by" varchar(256) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_workspace_audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"actor_user_id" varchar(256) NOT NULL,
	"action" varchar(64) NOT NULL,
	"target_type" varchar(32) NOT NULL,
	"target_id" varchar(64),
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_workspace_group_members" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"group_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"added_by" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_workspace_groups" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(64) NOT NULL,
	"description" text,
	"created_by" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_workspace_invitations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"email" varchar(256) NOT NULL,
	"role" varchar(64) NOT NULL,
	"group_ids" bigint[] DEFAULT '{}'::bigint[] NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"invited_by" varchar(256) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by_user_id" bigint,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_workspace_roles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_workspace_settings" (
	"company_id" bigint PRIMARY KEY NOT NULL,
	"join_policy" varchar(16) DEFAULT 'approval' NOT NULL,
	"audit_retention_days" integer,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_user_company_memberships" ALTER COLUMN "role" SET DATA TYPE varchar(64);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_users" ALTER COLUMN "role" SET DEFAULT 'member';--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_users" ALTER COLUMN "status" SET DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_invite_codes" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_invite_codes" ADD COLUMN "max_uses" integer;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_invite_codes" ADD COLUMN "use_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_user_company_memberships" ADD COLUMN "status" varchar(16) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_user_company_memberships" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_grants" ADD CONSTRAINT "pdr_ai_v2_document_grants_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_grants" ADD CONSTRAINT "pdr_ai_v2_document_grants_document_id_pdr_ai_v2_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."pdr_ai_v2_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_settings" ADD CONSTRAINT "pdr_ai_v2_document_settings_document_id_pdr_ai_v2_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."pdr_ai_v2_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_settings" ADD CONSTRAINT "pdr_ai_v2_document_settings_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_folder_grants" ADD CONSTRAINT "pdr_ai_v2_folder_grants_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_folder_grants" ADD CONSTRAINT "pdr_ai_v2_folder_grants_category_id_pdr_ai_v2_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."pdr_ai_v2_category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_folder_settings" ADD CONSTRAINT "pdr_ai_v2_folder_settings_category_id_pdr_ai_v2_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."pdr_ai_v2_category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_folder_settings" ADD CONSTRAINT "pdr_ai_v2_folder_settings_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_workspace_audit_events" ADD CONSTRAINT "pdr_ai_v2_workspace_audit_events_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_workspace_group_members" ADD CONSTRAINT "pdr_ai_v2_workspace_group_members_group_id_pdr_ai_v2_workspace_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."pdr_ai_v2_workspace_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_workspace_group_members" ADD CONSTRAINT "pdr_ai_v2_workspace_group_members_user_id_pdr_ai_v2_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."pdr_ai_v2_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_workspace_groups" ADD CONSTRAINT "pdr_ai_v2_workspace_groups_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_workspace_invitations" ADD CONSTRAINT "pdr_ai_v2_workspace_invitations_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_workspace_roles" ADD CONSTRAINT "pdr_ai_v2_workspace_roles_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_workspace_settings" ADD CONSTRAINT "pdr_ai_v2_workspace_settings_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_grants_document_principal_unique" ON "pdr_ai_v2_document_grants" USING btree ("document_id","principal_type","principal_id");--> statement-breakpoint
CREATE INDEX "document_grants_company_id_idx" ON "pdr_ai_v2_document_grants" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "document_grants_principal_idx" ON "pdr_ai_v2_document_grants" USING btree ("principal_type","principal_id");--> statement-breakpoint
CREATE INDEX "document_settings_company_id_idx" ON "pdr_ai_v2_document_settings" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "folder_grants_category_principal_unique" ON "pdr_ai_v2_folder_grants" USING btree ("category_id","principal_type","principal_id");--> statement-breakpoint
CREATE INDEX "folder_grants_company_id_idx" ON "pdr_ai_v2_folder_grants" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "folder_grants_principal_idx" ON "pdr_ai_v2_folder_grants" USING btree ("principal_type","principal_id");--> statement-breakpoint
CREATE INDEX "folder_settings_company_id_idx" ON "pdr_ai_v2_folder_settings" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "workspace_audit_events_company_created_idx" ON "pdr_ai_v2_workspace_audit_events" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "workspace_audit_events_company_action_idx" ON "pdr_ai_v2_workspace_audit_events" USING btree ("company_id","action");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_group_members_group_user_unique" ON "pdr_ai_v2_workspace_group_members" USING btree ("group_id","user_id");--> statement-breakpoint
CREATE INDEX "workspace_group_members_user_id_idx" ON "pdr_ai_v2_workspace_group_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_groups_company_slug_unique" ON "pdr_ai_v2_workspace_groups" USING btree ("company_id","slug");--> statement-breakpoint
CREATE INDEX "workspace_groups_company_id_idx" ON "pdr_ai_v2_workspace_groups" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_invitations_token_hash_unique" ON "pdr_ai_v2_workspace_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "workspace_invitations_company_id_idx" ON "pdr_ai_v2_workspace_invitations" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "workspace_invitations_email_idx" ON "pdr_ai_v2_workspace_invitations" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_roles_company_slug_unique" ON "pdr_ai_v2_workspace_roles" USING btree ("company_id","slug");--> statement-breakpoint
CREATE INDEX "workspace_roles_company_id_idx" ON "pdr_ai_v2_workspace_roles" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "user_company_memberships_company_status_idx" ON "pdr_ai_v2_user_company_memberships" USING btree ("company_id","status");