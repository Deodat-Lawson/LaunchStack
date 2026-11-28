CREATE TABLE "pdr_ai_v2_distribution_place_pools" (
	"cache_key" varchar(64) PRIMARY KEY NOT NULL,
	"country" varchar(2) NOT NULL,
	"region" varchar(128),
	"selectors" text NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"places" integer DEFAULT 0 NOT NULL,
	"state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX "distribution_place_pools_country_idx" ON "pdr_ai_v2_distribution_place_pools" USING btree ("country");