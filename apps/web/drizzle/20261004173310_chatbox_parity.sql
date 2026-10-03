ALTER TABLE "pdr_ai_v2_workspace_session_messages" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_workspace_sessions" ADD COLUMN "queued_messages" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_workspace_sessions" ADD COLUMN "queue_revision" integer DEFAULT 0 NOT NULL;