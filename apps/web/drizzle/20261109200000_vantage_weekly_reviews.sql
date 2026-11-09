-- Application-owned immutable accepted candidates. No fixture/bootstrap dependencies.
CREATE TABLE "pdr_ai_v2_vantage_weekly_review_runs" (
 "id" uuid PRIMARY KEY, "company_id" bigint NOT NULL,
 "owner_id" text NOT NULL, "week_start" date NOT NULL,
 "idempotency_key" text NOT NULL, "input_hash" text NOT NULL,
 "status" text NOT NULL CHECK (status IN ('reserved','accepted','failed')),
 "schema_version" text NOT NULL DEFAULT 'vantage-weekly-review/v2.1',
 "dependencies" jsonb NOT NULL, "ciphertext" text, "key_version" integer,
 "generation_dispatched" boolean NOT NULL DEFAULT false, "judge_dispatched" boolean NOT NULL DEFAULT false,
 "failure_code" text, "review_version" integer NOT NULL DEFAULT 1,
 "created_at" timestamptz NOT NULL DEFAULT now(), "accepted_at" timestamptz,
 UNIQUE ("company_id","owner_id","idempotency_key"),
 CHECK ((status='accepted') = (ciphertext IS NOT NULL))
);--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_vantage_weekly_review_active" (
 "company_id" bigint NOT NULL, "owner_id" text NOT NULL, "week_start" date NOT NULL,
 "run_id" uuid NOT NULL REFERENCES "pdr_ai_v2_vantage_weekly_review_runs"("id"),
 PRIMARY KEY ("company_id","owner_id","week_start")
);--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_vantage_weekly_review_decisions" (
 "id" uuid PRIMARY KEY, "company_id" bigint NOT NULL,
 "run_id" uuid NOT NULL REFERENCES "pdr_ai_v2_vantage_weekly_review_runs"("id"),
 "actor_id" text NOT NULL, "idempotency_key" text NOT NULL,
 "payload_hash" text NOT NULL, "ciphertext" text NOT NULL, "version" integer NOT NULL,
 "created_at" timestamptz NOT NULL DEFAULT now(),
 UNIQUE ("company_id","run_id","actor_id","idempotency_key"),
 UNIQUE ("run_id","version")
);--> statement-breakpoint
CREATE INDEX "vantage_weekly_review_owner_history" ON "pdr_ai_v2_vantage_weekly_review_runs" ("company_id","owner_id","week_start");

--> statement-breakpoint
CREATE TABLE pdr_ai_v2_vantage_weekly_review_epochs (company_id bigint PRIMARY KEY, version bigint NOT NULL DEFAULT 1);
--> statement-breakpoint
CREATE TABLE pdr_ai_v2_vantage_weekly_review_policy (company_id bigint PRIMARY KEY, architecture_document_id bigint NOT NULL, required_document_ids jsonb NOT NULL DEFAULT '[]', version integer NOT NULL DEFAULT 1);
--> statement-breakpoint
CREATE TABLE pdr_ai_v2_vantage_weekly_review_preferences (company_id bigint NOT NULL, actor_id text NOT NULL, star_document_ids jsonb NOT NULL DEFAULT '[]', version integer NOT NULL DEFAULT 1, PRIMARY KEY(company_id,actor_id));

--> statement-breakpoint
-- Covered authority mutations serialize only with the affected company's admission.
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
 EXECUTE format('CREATE TRIGGER vantage_authority_change BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION pdr_ai_v2_vantage_bump_authority()',tab);
 END LOOP;
END $$;



