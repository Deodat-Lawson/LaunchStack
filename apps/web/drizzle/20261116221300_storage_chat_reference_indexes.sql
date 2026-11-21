-- launchstack:no-transaction
-- Reason: Generated CREATE INDEX CONCURRENTLY statements must run outside a transaction so existing chat attachment, metadata, and queue writes stay available.
CREATE INDEX CONCURRENTLY "workspace_session_messages_attachments_idx" ON "pdr_ai_v2_workspace_session_messages" USING gin ("attachments" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX CONCURRENTLY "workspace_session_messages_metadata_idx" ON "pdr_ai_v2_workspace_session_messages" USING gin ("metadata" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX CONCURRENTLY "workspace_sessions_queued_messages_idx" ON "pdr_ai_v2_workspace_sessions" USING gin ("queued_messages" jsonb_path_ops);