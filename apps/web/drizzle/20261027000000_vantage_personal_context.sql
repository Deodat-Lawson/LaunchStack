ALTER TABLE "pdr_ai_v2_user_company_memberships"
ADD COLUMN "business_context_v0" jsonb,
ADD COLUMN "vantage_context_revision" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_vantage_document_stars" (
    "company_id" bigint NOT NULL,
    "user_id" bigint NOT NULL,
    "document_id" bigint NOT NULL,
    "last_known_version_id" bigint NOT NULL,
    "starred_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "pdr_ai_v2_vantage_document_stars_company_id_user_id_document_id_pk"
      PRIMARY KEY ("company_id", "user_id", "document_id"),
    CONSTRAINT "vantage_stars_membership_fk"
      FOREIGN KEY ("user_id", "company_id") REFERENCES "pdr_ai_v2_user_company_memberships"("user_id", "company_id") ON DELETE CASCADE,
    CONSTRAINT "vantage_stars_positive_ids" CHECK ("document_id" > 0 AND "last_known_version_id" > 0)
);
