ALTER TABLE "pdr_ai_v2_file_uploads" ADD COLUMN "company_id" bigint;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_file_uploads" ADD CONSTRAINT "pdr_ai_v2_file_uploads_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_uploads_company_id_idx" ON "pdr_ai_v2_file_uploads" USING btree ("company_id");
