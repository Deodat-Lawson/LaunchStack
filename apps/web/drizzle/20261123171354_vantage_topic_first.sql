CREATE TABLE "pdr_ai_v2_vantage_decision_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"topic_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_vantage_weekly_review_activation_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"owner_id" text NOT NULL,
	"week_start" date NOT NULL,
	"actor_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"kind" text NOT NULL,
	"previous_run_id" uuid,
	"run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pdr_ai_v2_vantage_weekly_revi_company_id_owner_id_idempote_key1" UNIQUE("company_id","owner_id","idempotency_key"),
	CONSTRAINT "pdr_ai_v2_vantage_weekly_review_activation_events_kind_check" CHECK ("pdr_ai_v2_vantage_weekly_review_activation_events"."kind" IN ('accepted','restored'))
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_vantage_weekly_review_active" (
	"company_id" bigint NOT NULL,
	"owner_id" text NOT NULL,
	"week_start" date NOT NULL,
	"run_id" uuid NOT NULL,
	CONSTRAINT "pdr_ai_v2_vantage_weekly_review_active_pkey" PRIMARY KEY("company_id","owner_id","week_start")
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_vantage_weekly_review_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"run_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"ciphertext" text NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pdr_ai_v2_vantage_weekly_revi_company_id_run_id_actor_id_id_key" UNIQUE("company_id","run_id","actor_id","idempotency_key"),
	CONSTRAINT "pdr_ai_v2_vantage_weekly_review_decisions_run_id_version_key" UNIQUE("run_id","version")
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_vantage_weekly_review_epochs" (
	"company_id" bigint PRIMARY KEY NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_vantage_weekly_review_policy" (
	"company_id" bigint PRIMARY KEY NOT NULL,
	"architecture_document_id" bigint NOT NULL,
	"required_document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_source_scopes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_vantage_weekly_review_preferences" (
	"company_id" bigint NOT NULL,
	"actor_id" text NOT NULL,
	"star_document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"star_source_scopes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"business_role_context" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "pdr_ai_v2_vantage_weekly_review_preferences_pkey" PRIMARY KEY("company_id","actor_id")
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_vantage_weekly_review_run_manifests" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"owner_id" text NOT NULL,
	"manifest_hash" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"trace" jsonb,
	"digest_ids" jsonb,
	"snapshot_commitment" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_vantage_weekly_review_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"owner_id" text NOT NULL,
	"week_start" date NOT NULL,
	"idempotency_key" text NOT NULL,
	"input_hash" text NOT NULL,
	"status" text NOT NULL,
	"schema_version" text DEFAULT 'vantage-weekly-review/v2.1' NOT NULL,
	"dependencies" jsonb NOT NULL,
	"ciphertext" text,
	"key_version" integer,
	"retrieval_mode" text DEFAULT 'topic_first' NOT NULL,
	"pinned_cutoff" timestamp with time zone,
	"pinned_as_of" timestamp with time zone,
	"authority_epoch" text,
	"exploration_dispatched" boolean DEFAULT false NOT NULL,
	"exploration_deadline_at" timestamp with time zone,
	"snapshot_hash" text,
	"last_dispatch_at" timestamp with time zone,
	"generation_dispatched" boolean DEFAULT false NOT NULL,
	"judge_dispatched" boolean DEFAULT false NOT NULL,
	"failure_code" text,
	"review_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "pdr_ai_v2_vantage_weekly_revi_company_id_owner_id_idempoten_key" UNIQUE("company_id","owner_id","idempotency_key"),
	CONSTRAINT "vantage_weekly_review_runs_retrieval_mode_check" CHECK ("pdr_ai_v2_vantage_weekly_review_runs"."retrieval_mode" IN ('topic_first')),
	CONSTRAINT "pdr_ai_v2_vantage_weekly_review_runs_status_check" CHECK ("pdr_ai_v2_vantage_weekly_review_runs"."status" IN ('reserved','accepted','failed')),
	CONSTRAINT "pdr_ai_v2_vantage_weekly_review_runs_check" CHECK (("pdr_ai_v2_vantage_weekly_review_runs"."status"='accepted') = ("pdr_ai_v2_vantage_weekly_review_runs"."ciphertext" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_vantage_personal_topic_watches" (
	"topic_id" uuid NOT NULL,
	"company_id" bigint NOT NULL,
	"owner_id" text NOT NULL,
	"document_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pdr_ai_v2_vantage_personal_topic_watches_topic_id_document_id_pk" PRIMARY KEY("topic_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_vantage_personal_topics" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"guidance" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "vantage_personal_topics_status_check" CHECK ("pdr_ai_v2_vantage_personal_topics"."status" IN ('active','closed')),
	CONSTRAINT "vantage_personal_topics_revision_check" CHECK ("pdr_ai_v2_vantage_personal_topics"."revision">0)
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_vantage_agenda_topics" ADD COLUMN "content_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_vantage_commitments" ADD COLUMN "content_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_vantage_weekly_review_activation_events" ADD CONSTRAINT "pdr_ai_v2_vantage_weekly_review_activation_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."pdr_ai_v2_vantage_weekly_review_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_vantage_weekly_review_activation_events" ADD CONSTRAINT "pdr_ai_v2_vantage_weekly_review_activation_previous_run_id_fkey" FOREIGN KEY ("previous_run_id") REFERENCES "public"."pdr_ai_v2_vantage_weekly_review_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_vantage_weekly_review_active" ADD CONSTRAINT "pdr_ai_v2_vantage_weekly_review_active_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."pdr_ai_v2_vantage_weekly_review_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_vantage_weekly_review_decisions" ADD CONSTRAINT "pdr_ai_v2_vantage_weekly_review_decisions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."pdr_ai_v2_vantage_weekly_review_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_vantage_weekly_review_run_manifests" ADD CONSTRAINT "pdr_ai_v2_vantage_weekly_review_run_manifests_run_id_pdr_ai_v2_vantage_weekly_review_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pdr_ai_v2_vantage_weekly_review_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_vantage_personal_topic_watches" ADD CONSTRAINT "pdr_ai_v2_vantage_personal_topic_watches_topic_id_pdr_ai_v2_vantage_personal_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."pdr_ai_v2_vantage_personal_topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_vantage_personal_topic_watches" ADD CONSTRAINT "pdr_ai_v2_vantage_personal_topic_watches_document_id_pdr_ai_v2_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."pdr_ai_v2_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_vantage_personal_topics" ADD CONSTRAINT "pdr_ai_v2_vantage_personal_topics_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vantage_weekly_review_owner_history" ON "pdr_ai_v2_vantage_weekly_review_runs" USING btree ("company_id","owner_id","week_start");--> statement-breakpoint
CREATE INDEX "vantage_personal_topics_owner" ON "pdr_ai_v2_vantage_personal_topics" USING btree ("company_id","owner_id","status");--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_vantage_agenda_topics" ADD CONSTRAINT "pdr_ai_v2_vantage_agenda_topics_content_version_check" CHECK ("pdr_ai_v2_vantage_agenda_topics"."content_version" > 0);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_vantage_commitments" ADD CONSTRAINT "pdr_ai_v2_vantage_commitments_content_version_check" CHECK ("pdr_ai_v2_vantage_commitments"."content_version" > 0);
--> statement-breakpoint
-- VANTAGE AUTHORITY OBJECTS
CREATE FUNCTION pdr_ai_v2_vantage_bump_authority() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item jsonb; cid bigint; did bigint; gid bigint; uid bigint;
BEGIN
 FOR item IN SELECT value FROM jsonb_array_elements(
   CASE WHEN TG_OP='INSERT' THEN jsonb_build_array(to_jsonb(NEW))
        WHEN TG_OP='DELETE' THEN jsonb_build_array(to_jsonb(OLD))
        ELSE jsonb_build_array(to_jsonb(OLD),to_jsonb(NEW)) END)
 LOOP
   cid := (item->>'company_id')::bigint;
   IF cid IS NULL THEN
     did := (item->>'document_id')::bigint;
     gid := (item->>'group_id')::bigint;
     IF did IS NOT NULL THEN SELECT company_id INTO cid FROM pdr_ai_v2_document WHERE id=did;
     ELSIF gid IS NOT NULL THEN SELECT company_id INTO cid FROM pdr_ai_v2_workspace_groups WHERE id=gid;
     END IF;
   END IF;
   IF cid IS NOT NULL THEN
     INSERT INTO pdr_ai_v2_vantage_weekly_review_epochs(company_id) VALUES(cid)
       ON CONFLICT(company_id) DO UPDATE SET version=pdr_ai_v2_vantage_weekly_review_epochs.version+1;
   END IF;
   IF TG_TABLE_NAME='pdr_ai_v2_users' THEN
     uid := (item->>'id')::bigint;
     FOR cid IN SELECT company_id FROM pdr_ai_v2_user_company_memberships WHERE user_id=uid ORDER BY company_id LOOP
       INSERT INTO pdr_ai_v2_vantage_weekly_review_epochs(company_id) VALUES(cid)
         ON CONFLICT(company_id) DO UPDATE SET version=pdr_ai_v2_vantage_weekly_review_epochs.version+1;
     END LOOP;
   END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
--> statement-breakpoint
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY[
 'pdr_ai_v2_users','pdr_ai_v2_user_company_memberships','pdr_ai_v2_workspace_roles',
 'pdr_ai_v2_workspace_groups','pdr_ai_v2_workspace_group_members',
 'pdr_ai_v2_folder_settings','pdr_ai_v2_folder_grants','pdr_ai_v2_document_settings','pdr_ai_v2_document_grants',
 'pdr_ai_v2_category','pdr_ai_v2_document','pdr_ai_v2_document_versions','pdr_ai_v2_document_context_chunks',
 'pdr_ai_v2_vantage_weekly_review_policy','pdr_ai_v2_vantage_weekly_review_preferences'
 ] LOOP
 EXECUTE format('CREATE TRIGGER vantage_authority_change AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION pdr_ai_v2_vantage_bump_authority()',tab);
 END LOOP;
END $$;




--> statement-breakpoint
-- Identity UPDATE classification, reviewed against require-workspace-context,
-- active-workspace, authz/resolve, authz/scope, rag/access, and workspace invitations.
-- Keep email (invitation identity) and legacy role/status conservatively covered.
-- users authority: id,userId,company_id,email,role,status
-- users incidental: name,last_active_at,created_at,updated_at,display_name,title,pronouns,time_zone,bio,provider_photo_checked_at
-- memberships authority: id,user_id,company_id,role,status
-- memberships incidental: last_opened_at,created_at,updated_at,profile_display_name,profile_title
-- The schema classification test requires every column to appear in exactly one list.
-- last_opened_at can choose a fallback workspace, whose identity is independently
-- checked against the expected actor at every authority boundary.
-- AFTER preserves the ON CONFLICT DO NOTHING and document-row/epoch lock ordering
-- fix. INSERT/DELETE and actual identity/permission changes still use the existing
-- OLD+NEW tenant invalidation function, inside the writing transaction.
-- Document, upload/version, chunk, policy, preference, and ACL table writes keep
-- their existing company-wide invalidation. This is only an identity-table filter.
DROP TRIGGER vantage_authority_change ON pdr_ai_v2_users;
--> statement-breakpoint
CREATE TRIGGER vantage_authority_change AFTER INSERT OR DELETE ON pdr_ai_v2_users
FOR EACH ROW EXECUTE FUNCTION pdr_ai_v2_vantage_bump_authority();
--> statement-breakpoint
CREATE TRIGGER vantage_authority_update AFTER UPDATE ON pdr_ai_v2_users
FOR EACH ROW WHEN (
    ROW(OLD.id, OLD."userId", OLD.company_id, OLD.email, OLD.role, OLD.status)
    IS DISTINCT FROM
    ROW(NEW.id, NEW."userId", NEW.company_id, NEW.email, NEW.role, NEW.status)
) EXECUTE FUNCTION pdr_ai_v2_vantage_bump_authority();
--> statement-breakpoint
DROP TRIGGER vantage_authority_change ON pdr_ai_v2_user_company_memberships;
--> statement-breakpoint
CREATE TRIGGER vantage_authority_change AFTER INSERT OR DELETE ON pdr_ai_v2_user_company_memberships
FOR EACH ROW EXECUTE FUNCTION pdr_ai_v2_vantage_bump_authority();
--> statement-breakpoint
CREATE TRIGGER vantage_authority_update AFTER UPDATE ON pdr_ai_v2_user_company_memberships
FOR EACH ROW WHEN (
    ROW(OLD.id, OLD.user_id, OLD.company_id, OLD.role, OLD.status)
    IS DISTINCT FROM
    ROW(NEW.id, NEW.user_id, NEW.company_id, NEW.role, NEW.status)
) EXECUTE FUNCTION pdr_ai_v2_vantage_bump_authority();
