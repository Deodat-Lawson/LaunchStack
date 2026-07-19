-- Founder Weekly Review persistence and lifecycle foundation (LAU-5).
--
-- Creates:
-- 1. pdr_ai_v2_founder_weekly_review_runs
-- 2. pdr_ai_v2_founder_weekly_review_operations
--
-- V1 decision: multiple runs are allowed per company and reporting period.
-- Idempotency is enforced by:
-- - create: UNIQUE(company_id, request_key)
-- - retry:  UNIQUE(run_id, operation_type, request_key)

CREATE TABLE IF NOT EXISTS "pdr_ai_v2_founder_weekly_review_runs" (
    "id" varchar(64) PRIMARY KEY,
    "company_id" bigint NOT NULL REFERENCES "pdr_ai_v2_company"("id") ON DELETE CASCADE,
    "request_key" varchar(128) NOT NULL,
    "reporting_period_start" date NOT NULL,
    "reporting_period_end" date NOT NULL,
    "status" varchar(32) NOT NULL DEFAULT 'queued',
    "review_payload" jsonb,
    "review_schema_version" varchar(64) NOT NULL,
    "evidence_snapshot" jsonb NOT NULL,
    "evidence_schema_version" varchar(64) NOT NULL,
    "model_metadata" jsonb,
    "created_by_actor_id" varchar(256) NOT NULL,
    "retry_count" integer NOT NULL DEFAULT 0,
    "failure_sequence" integer NOT NULL DEFAULT 0,
    "generation_attempt" integer NOT NULL DEFAULT 0,
    "generation_claim_id" varchar(128),
    "generation_job_id" varchar(256),
    "queued_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" timestamptz,
    "generation_started_at" timestamptz,
    "generated_at" timestamptz,
    "published_at" timestamptz,
    "error_code" varchar(128),
    "error_message" varchar(1024),
    "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamptz DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "pdr_ai_v2_founder_weekly_review_operations" (
    "id" varchar(64) PRIMARY KEY,
    "run_id" varchar(64) NOT NULL REFERENCES "pdr_ai_v2_founder_weekly_review_runs"("id") ON DELETE CASCADE,
    "company_id" bigint NOT NULL REFERENCES "pdr_ai_v2_company"("id") ON DELETE CASCADE,
    "operation_type" varchar(32) NOT NULL,
    "request_key" varchar(128) NOT NULL,
    "source_failure_sequence" integer NOT NULL,
    "actor_id" varchar(256) NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "founder_weekly_review_runs_company_request_key_unique"
    ON "pdr_ai_v2_founder_weekly_review_runs" ("company_id", "request_key");

CREATE UNIQUE INDEX IF NOT EXISTS "founder_weekly_review_operations_run_type_request_key_unique"
    ON "pdr_ai_v2_founder_weekly_review_operations" ("run_id", "operation_type", "request_key");

CREATE INDEX IF NOT EXISTS "founder_weekly_review_runs_company_created_at_idx"
    ON "pdr_ai_v2_founder_weekly_review_runs" ("company_id", "created_at");

CREATE INDEX IF NOT EXISTS "founder_weekly_review_runs_company_status_created_at_idx"
    ON "pdr_ai_v2_founder_weekly_review_runs" ("company_id", "status", "created_at");

CREATE INDEX IF NOT EXISTS "founder_weekly_review_runs_company_period_idx"
    ON "pdr_ai_v2_founder_weekly_review_runs" ("company_id", "reporting_period_start", "reporting_period_end");

CREATE INDEX IF NOT EXISTS "founder_weekly_review_runs_claim_idx"
    ON "pdr_ai_v2_founder_weekly_review_runs" ("company_id", "id", "status", "generation_claim_id");

CREATE INDEX IF NOT EXISTS "founder_weekly_review_operations_company_run_created_at_idx"
    ON "pdr_ai_v2_founder_weekly_review_operations" ("company_id", "run_id", "created_at");

CREATE INDEX IF NOT EXISTS "founder_weekly_review_operations_run_type_created_at_idx"
    ON "pdr_ai_v2_founder_weekly_review_operations" ("run_id", "operation_type", "created_at");
