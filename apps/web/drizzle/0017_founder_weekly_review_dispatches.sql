-- Durable outbox for Founder Weekly Review generation events (LAU-9).
CREATE TABLE IF NOT EXISTS "pdr_ai_v2_founder_weekly_review_dispatches" (
    "id" varchar(64) PRIMARY KEY,
    "company_id" bigint NOT NULL REFERENCES "pdr_ai_v2_company"("id") ON DELETE CASCADE,
    "run_id" varchar(64) NOT NULL REFERENCES "pdr_ai_v2_founder_weekly_review_runs"("id") ON DELETE CASCADE,
    "operation_type" varchar(16) NOT NULL,
    "operation_key" varchar(128) NOT NULL,
    "event_id" varchar(128) NOT NULL,
    "generation_job_id" varchar(128) NOT NULL,
    "generation_claim_id" varchar(128) NOT NULL,
    "status" varchar(16) NOT NULL DEFAULT 'pending',
    "attempt_count" integer NOT NULL DEFAULT 0,
    "available_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" timestamptz,
    "last_error_code" varchar(128),
    "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamptz DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "founder_weekly_review_dispatches_run_operation_key_unique"
    ON "pdr_ai_v2_founder_weekly_review_dispatches" ("run_id", "operation_type", "operation_key");
CREATE UNIQUE INDEX IF NOT EXISTS "founder_weekly_review_dispatches_event_id_unique"
    ON "pdr_ai_v2_founder_weekly_review_dispatches" ("event_id");
CREATE INDEX IF NOT EXISTS "founder_weekly_review_dispatches_pending_idx"
    ON "pdr_ai_v2_founder_weekly_review_dispatches" ("status", "available_at", "created_at");
CREATE INDEX IF NOT EXISTS "founder_weekly_review_dispatches_company_run_idx"
    ON "pdr_ai_v2_founder_weekly_review_dispatches" ("company_id", "run_id");
