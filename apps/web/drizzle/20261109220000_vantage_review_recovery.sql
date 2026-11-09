CREATE TABLE "pdr_ai_v2_vantage_weekly_review_activation_events" (
 "id" uuid PRIMARY KEY, "company_id" bigint NOT NULL, "owner_id" text NOT NULL,
 "week_start" date NOT NULL, "actor_id" text NOT NULL, "idempotency_key" text NOT NULL,
 "payload_hash" text NOT NULL, "kind" text NOT NULL CHECK (kind IN ('accepted','restored')),
 "previous_run_id" uuid REFERENCES "pdr_ai_v2_vantage_weekly_review_runs"("id"),
 "run_id" uuid NOT NULL REFERENCES "pdr_ai_v2_vantage_weekly_review_runs"("id"),
 "created_at" timestamptz NOT NULL DEFAULT now(),
 UNIQUE ("company_id","owner_id","idempotency_key")
);

