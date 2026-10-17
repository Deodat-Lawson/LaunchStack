CREATE TABLE "pdr_ai_v2_vantage_contract_state" (
    "agenda_id" varchar(64) PRIMARY KEY REFERENCES "pdr_ai_v2_vantage_agendas"("id") ON DELETE CASCADE,
    "company_id" bigint NOT NULL REFERENCES "pdr_ai_v2_company"("id") ON DELETE CASCADE,
    "version" integer NOT NULL DEFAULT 0,
    "payload" jsonb NOT NULL DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE UNIQUE INDEX "vantage_commitments_primary_topic_unique"
ON "pdr_ai_v2_vantage_commitments" ("company_id", "topic_id")
WHERE "topic_id" IS NOT NULL;
