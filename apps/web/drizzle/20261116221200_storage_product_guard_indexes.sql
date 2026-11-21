-- launchstack:no-transaction
-- Reason: Generated CREATE INDEX CONCURRENTLY statements must run outside a transaction to avoid blocking writes on existing media and avatar tables.
CREATE INDEX CONCURRENTLY "brand_channels_avatar_url_idx" ON "pdr_ai_v2_brand_channels" USING hash ("avatar_url");--> statement-breakpoint
CREATE INDEX CONCURRENTLY "brand_media_storage_url_idx" ON "pdr_ai_v2_brand_media" USING hash ("storage_url");--> statement-breakpoint
CREATE INDEX CONCURRENTLY "collab_persona_avatar_url_idx" ON "pdr_ai_v2_collab_agent_persona" USING hash ("avatar_url");