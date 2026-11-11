CREATE INDEX "document_url_idx" ON "pdr_ai_v2_document" USING btree ("url");--> statement-breakpoint
CREATE INDEX "doc_versions_url_idx" ON "pdr_ai_v2_document_versions" USING btree ("url");