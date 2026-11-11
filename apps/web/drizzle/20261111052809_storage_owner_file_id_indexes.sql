-- launchstack:no-transaction
-- Reason: Generated concurrent file-id indexes must run outside transactions and keep existing avatar/media writers available.
CREATE INDEX CONCURRENTLY "brand_channels_avatar_file_id_idx" ON "pdr_ai_v2_brand_channels" USING btree (((regexp_match("avatar_url", '/api/files/0*([0-9]+)([/?#]|$)'))[1]));--> statement-breakpoint
CREATE INDEX CONCURRENTLY "brand_media_storage_file_id_idx" ON "pdr_ai_v2_brand_media" USING btree (((regexp_match("storage_url", '/api/files/0*([0-9]+)([/?#]|$)'))[1]));--> statement-breakpoint
CREATE INDEX CONCURRENTLY "collab_persona_avatar_file_id_idx" ON "pdr_ai_v2_collab_agent_persona" USING btree (((regexp_match("avatar_url", '/api/files/0*([0-9]+)([/?#]|$)'))[1]));