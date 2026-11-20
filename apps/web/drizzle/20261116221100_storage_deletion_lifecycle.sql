CREATE TABLE "pdr_ai_v2_storage_deletion_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"request_id" bigint NOT NULL,
	"stored_object_id" bigint,
	"adapter" varchar(32),
	"storage_location_id" varchar(256),
	"object_key" text,
	"source_url" text NOT NULL,
	"state" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_code" varchar(64),
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_deletion_items_ref_check" CHECK (("pdr_ai_v2_storage_deletion_items"."adapter" IS NOT NULL AND "pdr_ai_v2_storage_deletion_items"."storage_location_id" IS NOT NULL AND "pdr_ai_v2_storage_deletion_items"."object_key" IS NOT NULL) OR ("pdr_ai_v2_storage_deletion_items"."state" IN ('quarantined', 'skipped') AND "pdr_ai_v2_storage_deletion_items"."adapter" IS NULL AND "pdr_ai_v2_storage_deletion_items"."storage_location_id" IS NULL AND "pdr_ai_v2_storage_deletion_items"."object_key" IS NULL)),
	CONSTRAINT "storage_deletion_items_state_check" CHECK ("pdr_ai_v2_storage_deletion_items"."state" IN ('pending', 'deleted', 'not_found', 'retained', 'blocked', 'quarantined', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_storage_deletion_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"scope" varchar(16) NOT NULL,
	"document_id" bigint,
	"document_version_id" bigint,
	"requested_by" varchar(256) NOT NULL,
	"reason" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"trace_id" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "storage_deletion_requests_scope_check" CHECK ("pdr_ai_v2_storage_deletion_requests"."scope" IN ('document', 'version', 'object')),
	CONSTRAINT "storage_deletion_requests_status_check" CHECK ("pdr_ai_v2_storage_deletion_requests"."status" IN ('pending', 'completed', 'blocked'))
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_storage_deletion_items" ADD CONSTRAINT "pdr_ai_v2_storage_deletion_items_request_id_pdr_ai_v2_storage_deletion_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."pdr_ai_v2_storage_deletion_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_storage_deletion_items" ADD CONSTRAINT "pdr_ai_v2_storage_deletion_items_stored_object_id_pdr_ai_v2_storage_objects_id_fk" FOREIGN KEY ("stored_object_id") REFERENCES "public"."pdr_ai_v2_storage_objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "storage_deletion_items_request_url_unique" ON "pdr_ai_v2_storage_deletion_items" USING btree ("request_id","source_url");--> statement-breakpoint
CREATE INDEX "storage_deletion_items_state_idx" ON "pdr_ai_v2_storage_deletion_items" USING btree ("state");--> statement-breakpoint
CREATE INDEX "storage_deletion_requests_status_created_idx" ON "pdr_ai_v2_storage_deletion_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "storage_deletion_requests_company_created_idx" ON "pdr_ai_v2_storage_deletion_requests" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "storage_deletion_requests_document_idx" ON "pdr_ai_v2_storage_deletion_requests" USING btree ("document_id");