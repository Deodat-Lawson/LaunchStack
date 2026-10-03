CREATE TABLE "pdr_ai_v2_company_profile_sources" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"document_id" bigint NOT NULL,
	"version_id" bigint,
	"role" varchar(16),
	"role_by" varchar(8),
	"reason" text,
	"override" varchar(16),
	"override_by" varchar(256),
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"error" text,
	"facts" jsonb,
	"fact_count" integer DEFAULT 0 NOT NULL,
	"passages" jsonb,
	"reader_version" varchar(32),
	"model_id" varchar(128),
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
-- Proposals' own profile is retired: the company profile is the one profile.
-- Facts a person added there by hand become manual edits of the company
-- profile (which rebuilds never overwrite); the rest is rebuilt from sources.
INSERT INTO "pdr_ai_v2_company_metadata" ("company_id", "schema_version", "metadata")
SELECT p."company_id", '1.0.0', jsonb_build_object(
    'schema_version', '1.0.0',
    'company_id', p."company_id"::text,
    'updated_at', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'company', '{}'::jsonb, 'people', '[]'::jsonb, 'services', '[]'::jsonb,
    'markets', '{}'::jsonb, 'projects', '[]'::jsonb, 'policies', '{}'::jsonb, 'legal', '[]'::jsonb,
    'provenance', jsonb_build_object('total_documents_processed', 0, 'extraction_model', '', 'extraction_version', '1.0.0'))
FROM "pdr_ai_v2_proposal_profiles" p
WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p."profile"->'facts', '[]'::jsonb)) f
    WHERE f->>'source' = 'manual')
ON CONFLICT ("company_id") DO NOTHING;--> statement-breakpoint
UPDATE "pdr_ai_v2_company_metadata" m
SET "metadata" = jsonb_set(
    m."metadata",
    '{profile}',
    COALESCE(m."metadata"->'profile', '{}'::jsonb)
        || jsonb_build_object('facts', COALESCE(m."metadata"->'profile'->'facts', '{}'::jsonb) || manual.facts))
FROM (
    SELECT p."company_id", jsonb_object_agg(
        left(regexp_replace(lower(f->>'key'), '[^a-z0-9_]', '_', 'g'), 64),
        jsonb_build_object(
            'value', f->>'value',
            'label', COALESCE(NULLIF(f->>'label', ''), f->>'key'),
            'visibility', 'private',
            'usage', 'outreach_ok_with_approval',
            'confidence', 1,
            'priority', 'manual_override',
            'status', 'active',
            'last_updated', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            'sources', jsonb_build_array(jsonb_build_object(
                'doc_id', 0,
                'doc_name', 'Manual edit',
                'extracted_at', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))))) AS facts
    FROM "pdr_ai_v2_proposal_profiles" p,
        jsonb_array_elements(COALESCE(p."profile"->'facts', '[]'::jsonb)) f
    WHERE f->>'source' = 'manual' AND COALESCE(f->>'key', '') <> '' AND COALESCE(f->>'value', '') <> ''
    GROUP BY p."company_id"
) manual
WHERE m."company_id" = manual."company_id";--> statement-breakpoint
DELETE FROM "pdr_ai_v2_proposal_runs" WHERE "kind" = 'profile';--> statement-breakpoint
DROP TABLE "pdr_ai_v2_proposal_profiles" CASCADE;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_company_metadata" ADD COLUMN "build_status" varchar(16) DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_company_metadata" ADD COLUMN "build_error" text;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_company_metadata" ADD COLUMN "build_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_company_metadata" ADD COLUMN "built_at" timestamp with time zone;--> statement-breakpoint
-- Profiles built before this release read as built (and stale), not as empty.
UPDATE "pdr_ai_v2_company_metadata" SET "built_at" = COALESCE("updated_at", "created_at") WHERE "built_at" IS NULL;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_company_profile_sources" ADD CONSTRAINT "pdr_ai_v2_company_profile_sources_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_company_profile_sources" ADD CONSTRAINT "pdr_ai_v2_company_profile_sources_document_id_pdr_ai_v2_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."pdr_ai_v2_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_profile_sources_document_unique" ON "pdr_ai_v2_company_profile_sources" USING btree ("company_id","document_id");--> statement-breakpoint
CREATE INDEX "company_profile_sources_document_id_idx" ON "pdr_ai_v2_company_profile_sources" USING btree ("document_id");