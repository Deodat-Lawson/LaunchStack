CREATE TABLE "pdr_ai_v2_extraction_rows" (
	"id" serial PRIMARY KEY NOT NULL,
	"table_id" integer NOT NULL,
	"company_id" bigint NOT NULL,
	"document_id" bigint NOT NULL,
	"document_title" varchar(256) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"cells" jsonb NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_extraction_tables" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"created_by_user_id" varchar(256) NOT NULL,
	"title" varchar(200) NOT NULL,
	"fields" jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"usage" jsonb NOT NULL,
	"error" text,
	"shared_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_extraction_rows" ADD CONSTRAINT "pdr_ai_v2_extraction_rows_table_id_pdr_ai_v2_extraction_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."pdr_ai_v2_extraction_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_extraction_rows" ADD CONSTRAINT "pdr_ai_v2_extraction_rows_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_extraction_rows" ADD CONSTRAINT "pdr_ai_v2_extraction_rows_document_id_pdr_ai_v2_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."pdr_ai_v2_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_extraction_tables" ADD CONSTRAINT "pdr_ai_v2_extraction_tables_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "extraction_rows_table_document_unique" ON "pdr_ai_v2_extraction_rows" USING btree ("table_id","document_id");--> statement-breakpoint
CREATE INDEX "extraction_rows_table_status_idx" ON "pdr_ai_v2_extraction_rows" USING btree ("table_id","status");--> statement-breakpoint
CREATE INDEX "extraction_rows_company_idx" ON "pdr_ai_v2_extraction_rows" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "extraction_rows_document_idx" ON "pdr_ai_v2_extraction_rows" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "extraction_tables_company_creator_idx" ON "pdr_ai_v2_extraction_tables" USING btree ("company_id","created_by_user_id","created_at");--> statement-breakpoint
CREATE INDEX "extraction_tables_status_idx" ON "pdr_ai_v2_extraction_tables" USING btree ("status");