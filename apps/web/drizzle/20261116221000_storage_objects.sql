CREATE TABLE "pdr_ai_v2_storage_objects" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"adapter" varchar(32) NOT NULL,
	"storage_location_id" varchar(256) NOT NULL,
	"object_key" text NOT NULL,
	"url" text NOT NULL,
	"company_id" bigint,
	"content_type" varchar(256),
	"size_bytes" bigint,
	"checksum" varchar(256),
	"source" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "storage_objects_identity_unique" ON "pdr_ai_v2_storage_objects" USING btree ("adapter","storage_location_id","object_key");--> statement-breakpoint
CREATE INDEX "storage_objects_url_idx" ON "pdr_ai_v2_storage_objects" USING hash ("url");--> statement-breakpoint
CREATE INDEX "storage_objects_company_created_idx" ON "pdr_ai_v2_storage_objects" USING btree ("company_id","created_at");