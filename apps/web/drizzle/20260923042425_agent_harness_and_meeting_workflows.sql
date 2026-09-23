ALTER TABLE "pdr_ai_v2_collab_agent_persona" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_collab_agent_persona" ADD COLUMN "mode" varchar(16);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_collab_agent_persona" ADD COLUMN "tools" jsonb;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_collab_agent_persona" ADD COLUMN "style" varchar(24);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_collab_agent_persona" ADD COLUMN "builtin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_collab_meeting" ADD COLUMN "workflow_key" varchar(64);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_collab_meeting" ADD COLUMN "phases" jsonb;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_workspace_session_messages" ADD COLUMN "agent_key" varchar(64);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_workspace_sessions" ADD COLUMN "agent_key" varchar(64);