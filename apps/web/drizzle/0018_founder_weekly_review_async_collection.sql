-- Move Founder Weekly Review evidence collection into the durable workflow.
ALTER TABLE "pdr_ai_v2_founder_weekly_review_runs"
    ALTER COLUMN "evidence_snapshot" DROP NOT NULL;
ALTER TABLE "pdr_ai_v2_founder_weekly_review_runs"
    ADD COLUMN "collection_input" jsonb,
    ADD COLUMN "collection_claim_id" varchar(128),
    ADD COLUMN "collection_started_at" timestamptz,
    ADD COLUMN "evidence_collected_at" timestamptz;

-- Existing pre-workflow rows already have a persisted snapshot.  Their actor is
-- retained only as a bounded durable collection input; it is never exposed.
UPDATE "pdr_ai_v2_founder_weekly_review_runs"
SET "collection_input" = jsonb_build_object(
    'workspaceTimezone', COALESCE("evidence_snapshot"->>'workspaceTimezone', 'UTC'),
    'actorExternalUserId', regexp_replace("created_by_actor_id", '^user:', '')
)
WHERE "collection_input" IS NULL;

ALTER TABLE "pdr_ai_v2_founder_weekly_review_runs"
    ALTER COLUMN "collection_input" SET NOT NULL;
CREATE INDEX "founder_weekly_review_runs_collection_claim_idx"
    ON "pdr_ai_v2_founder_weekly_review_runs" ("company_id", "id", "status", "collection_claim_id");
