-- Operational metadata is deliberately separate from zero-retention traces.
ALTER TABLE "pdr_ai_v2_vantage_weekly_review_runs" ADD COLUMN "failure_record" jsonb;
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_vantage_weekly_review_provider_attempts" (
    "id" uuid PRIMARY KEY NOT NULL,
    "run_id" uuid NOT NULL,
    "company_id" bigint NOT NULL,
    "owner_id" text NOT NULL,
    "stage" text NOT NULL,
    "attempt_ordinal" integer NOT NULL,
    "message_bytes" integer,
    "outcome" jsonb,
    "started_at" timestamp with time zone DEFAULT now() NOT NULL,
    "settled_at" timestamp with time zone,
    CONSTRAINT "vantage_review_provider_attempt_stage" CHECK ("stage" IN ('digest','exploration','generation','judge')),
    CONSTRAINT "vantage_review_provider_attempt_ordinal" CHECK ("attempt_ordinal">0),
    CONSTRAINT "vantage_review_provider_attempt_bytes" CHECK ("message_bytes" IS NULL OR "message_bytes">=0),
    CONSTRAINT "vantage_review_provider_attempt_settlement" CHECK (("settled_at" IS NULL) = ("outcome" IS NULL)),
    CONSTRAINT "pdr_ai_v2_vantage_weekly_review_provider_attempts_run_id_pdr_ai_v2_vantage_weekly_review_runs_id_fk"
        FOREIGN KEY ("run_id") REFERENCES "public"."pdr_ai_v2_vantage_weekly_review_runs"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "vantage_review_provider_attempt_run" ON "pdr_ai_v2_vantage_weekly_review_provider_attempts" USING btree ("company_id","owner_id","run_id","started_at");
--> statement-breakpoint
-- Historical failures never acquire guessed diagnostic measurements.
UPDATE "pdr_ai_v2_vantage_weekly_review_runs"
SET "failure_record"='{"schemaVersion":"vantage-failure/v1","stage":"unknown","code":"candidate_not_admitted","statusClass":"unknown","validatorCodes":[],"judgeCodes":[],"counts":{"sourceUnits":null,"evidenceBytes":null,"messageBytes":null,"citationsChecked":null,"citationsFailed":null,"providerAttempts":null,"providerFailures":null},"provider":{"statusClass":"unknown","httpStatus":null,"retryAfterMs":null,"usage":{"inputTokens":null,"outputTokens":null,"totalTokens":null,"reasoningTokens":null,"cachedInputTokens":null}}}'::jsonb,
    "ciphertext"=NULL,"key_version"=NULL
WHERE "status"='failed';
--> statement-breakpoint
UPDATE "pdr_ai_v2_vantage_weekly_review_run_manifests" m SET "trace"=NULL
FROM "pdr_ai_v2_vantage_weekly_review_runs" r WHERE m."run_id"=r."id" AND r."status"='failed';
