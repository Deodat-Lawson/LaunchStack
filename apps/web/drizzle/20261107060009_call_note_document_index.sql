ALTER TABLE "pdr_ai_v2_call_notes_calls" ADD COLUMN "indexed_document_id" bigint;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_calls" ADD COLUMN "indexed_revision" integer;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_calls" ADD CONSTRAINT "pdr_ai_v2_call_notes_calls_indexed_document_id_pdr_ai_v2_document_id_fk" FOREIGN KEY ("indexed_document_id") REFERENCES "public"."pdr_ai_v2_document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_notes_calls_company_indexed_document_idx" ON "pdr_ai_v2_call_notes_calls" USING btree ("company_id","indexed_document_id");--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_calls" DROP COLUMN "knowledge_included";