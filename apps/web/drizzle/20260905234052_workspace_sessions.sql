CREATE TABLE "pdr_ai_v2_workspace_session_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" varchar(64) NOT NULL,
	"seq" integer NOT NULL,
	"role" varchar(16) NOT NULL,
	"text" text NOT NULL,
	"refs" jsonb,
	"citations" jsonb,
	"attachments" jsonb,
	"model" varchar(120),
	"tokens" integer,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_workspace_sessions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"title" varchar(300) NOT NULL,
	"context_source_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"continuation" jsonb,
	"message_count" integer DEFAULT 0 NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_workspace_session_messages" ADD CONSTRAINT "pdr_ai_v2_workspace_session_messages_session_id_pdr_ai_v2_workspace_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."pdr_ai_v2_workspace_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_workspace_sessions" ADD CONSTRAINT "pdr_ai_v2_workspace_sessions_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_session_messages_session_seq_uq" ON "pdr_ai_v2_workspace_session_messages" USING btree ("session_id","seq");--> statement-breakpoint
CREATE INDEX "workspace_sessions_owner_recent_idx" ON "pdr_ai_v2_workspace_sessions" USING btree ("company_id","user_id","last_message_at");--> statement-breakpoint
CREATE INDEX "workspace_sessions_company_idx" ON "pdr_ai_v2_workspace_sessions" USING btree ("company_id");