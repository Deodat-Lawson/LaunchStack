-- Product baseline: the 36 tables the application and its feature verticals own.
--
-- Generated from apps/web/src/server/db/schema and packages/features/src/*/schema.ts.
-- Applied AFTER the engine set: the foreign keys below reference engine tables
-- (pdr_ai_v2_company, pdr_ai_v2_document) that the engine baseline creates.
CREATE TABLE "pdr_ai_v2_agent_ai_chatbot_chat" (
	"id" varchar(256) PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"title" text NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"visibility" varchar(20) DEFAULT 'private' NOT NULL,
	"agent_mode" varchar(50) DEFAULT 'interactive' NOT NULL,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"ai_style" varchar(50) DEFAULT 'concise',
	"ai_persona" varchar(50) DEFAULT 'general',
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_agent_ai_chatbot_document" (
	"id" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"kind" varchar(20) DEFAULT 'text' NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"chat_id" varchar(256),
	"task_id" varchar(256),
	CONSTRAINT "pdr_ai_v2_agent_ai_chatbot_document_id_created_at_pk" PRIMARY KEY("id","created_at")
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_agent_ai_chatbot_execution_step" (
	"id" varchar(256) PRIMARY KEY NOT NULL,
	"task_id" varchar(256) NOT NULL,
	"step_number" integer NOT NULL,
	"step_type" varchar(50) NOT NULL,
	"description" text NOT NULL,
	"reasoning" text,
	"input" jsonb,
	"output" jsonb,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_agent_ai_chatbot_memory" (
	"id" varchar(256) PRIMARY KEY NOT NULL,
	"chat_id" varchar(256) NOT NULL,
	"memory_type" varchar(50) NOT NULL,
	"key" varchar(256) NOT NULL,
	"value" jsonb NOT NULL,
	"importance" integer DEFAULT 5 NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_agent_ai_chatbot_message" (
	"id" varchar(256) PRIMARY KEY NOT NULL,
	"chat_id" varchar(256) NOT NULL,
	"role" varchar(50) NOT NULL,
	"content" jsonb NOT NULL,
	"message_type" varchar(50) DEFAULT 'text' NOT NULL,
	"parent_message_id" varchar(256),
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_agent_ai_chatbot_suggestion" (
	"id" varchar(256) PRIMARY KEY NOT NULL,
	"document_id" varchar(256) NOT NULL,
	"document_created_at" timestamp with time zone NOT NULL,
	"original_text" text NOT NULL,
	"suggested_text" text NOT NULL,
	"description" text,
	"is_resolved" boolean DEFAULT false NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_agent_ai_chatbot_task" (
	"id" varchar(256) PRIMARY KEY NOT NULL,
	"chat_id" varchar(256) NOT NULL,
	"description" text NOT NULL,
	"objective" text NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_agent_ai_chatbot_tool_call" (
	"id" varchar(256) PRIMARY KEY NOT NULL,
	"message_id" varchar(256) NOT NULL,
	"task_id" varchar(256),
	"tool_name" varchar(256) NOT NULL,
	"tool_input" jsonb NOT NULL,
	"tool_output" jsonb,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"execution_time_ms" integer,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_agent_ai_chatbot_tool_registry" (
	"id" varchar(256) PRIMARY KEY NOT NULL,
	"name" varchar(256) NOT NULL,
	"description" text NOT NULL,
	"category" varchar(100) NOT NULL,
	"schema" jsonb NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"required_permissions" jsonb,
	"rate_limit" integer,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "pdr_ai_v2_agent_ai_chatbot_tool_registry_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_agent_ai_chatbot_vote" (
	"chat_id" varchar(256) NOT NULL,
	"message_id" varchar(256) NOT NULL,
	"is_upvoted" boolean NOT NULL,
	"feedback" text,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "pdr_ai_v2_agent_ai_chatbot_vote_chat_id_message_id_pk" PRIMARY KEY("chat_id","message_id")
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_collab_agent_persona" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"key" varchar(64) NOT NULL,
	"display_name" varchar(128) NOT NULL,
	"role" varchar(128) NOT NULL,
	"system_prompt" text NOT NULL,
	"node_id" varchar(128),
	"route" varchar(32),
	"temperature_x100" integer,
	"max_turn_chars" integer,
	"accent" varchar(32),
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_collab_channel" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"slug" varchar(96) NOT NULL,
	"name" varchar(256) NOT NULL,
	"topic" text,
	"slack_channel_id" varchar(64),
	"archived" boolean DEFAULT false NOT NULL,
	"created_by_user_id" varchar(256),
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_collab_meeting" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"channel_id" varchar(64) NOT NULL,
	"title" varchar(256) NOT NULL,
	"objective" text NOT NULL,
	"agenda" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"participants" jsonb NOT NULL,
	"turn_policy" varchar(24) DEFAULT 'round_robin' NOT NULL,
	"moderator_persona_id" varchar(128),
	"max_turns" integer DEFAULT 12 NOT NULL,
	"completion_marker" varchar(64),
	"context" jsonb,
	"status" varchar(24) DEFAULT 'scheduled' NOT NULL,
	"turn_index" integer DEFAULT 0 NOT NULL,
	"next_speaker_id" varchar(128),
	"controller" jsonb,
	"error" text,
	"slack_channel_id" varchar(64),
	"slack_mirror_enabled" boolean DEFAULT false NOT NULL,
	"slack_use_agent_identity" boolean DEFAULT false NOT NULL,
	"created_by_user_id" varchar(256),
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_collab_message" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"channel_id" varchar(64) NOT NULL,
	"seq" integer NOT NULL,
	"author_kind" varchar(16) NOT NULL,
	"author_id" varchar(128) NOT NULL,
	"author_name" varchar(256) NOT NULL,
	"on_behalf_of_persona_id" varchar(128),
	"body" text NOT NULL,
	"kind" varchar(24) DEFAULT 'chat' NOT NULL,
	"thread_id" varchar(64),
	"slack_ts" varchar(32),
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_collab_node" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"label" varchar(256),
	"persona_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_remote_address" varchar(64),
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_token_accounts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"balance_tokens" integer DEFAULT 0 NOT NULL,
	"lifetime_tokens_purchased" integer DEFAULT 0 NOT NULL,
	"lifetime_tokens_granted" integer DEFAULT 0 NOT NULL,
	"lifetime_tokens_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_token_grants" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"grant_type" varchar(30) NOT NULL,
	"amount" integer NOT NULL,
	"expires_at" timestamp with time zone,
	"granted_by" varchar(256),
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_token_transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"type" varchar(20) NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"description" varchar(500),
	"service" varchar(50),
	"reference_id" varchar(256),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_token_usage_daily" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"date" date NOT NULL,
	"service" varchar(50) NOT NULL,
	"operation_count" integer DEFAULT 0 NOT NULL,
	"tokens_used" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_chat_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"document_id" bigint NOT NULL,
	"document_title" varchar(256) NOT NULL,
	"question" text NOT NULL,
	"response" text NOT NULL,
	"chat_id" varchar(256),
	"query_type" varchar(20) DEFAULT 'simple',
	"pages" integer[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_document_reference_resolutions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"reference_name" varchar(256) NOT NULL,
	"resolved_in_document_id" bigint,
	"resolution_details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_document_views" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"document_id" bigint NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"company_id" bigint NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_generated_documents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"company_id" bigint NOT NULL,
	"title" varchar(512) NOT NULL,
	"content" text NOT NULL,
	"template_id" varchar(64),
	"metadata" jsonb,
	"citations" jsonb,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_predictive_document_analysis_results" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"document_id" bigint NOT NULL,
	"analysis_type" varchar(256) NOT NULL,
	"include_related_docs" boolean DEFAULT false,
	"result_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_document_note_embeddings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"note_id" bigint NOT NULL,
	"user_id" varchar(256),
	"document_id" varchar(256),
	"company_id" varchar(256),
	"version_id" bigint,
	"content" text NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"embedding" vector(1536),
	"embedding_short" vector(512),
	"model_version" varchar(64),
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_document_notes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"company_id" varchar(256),
	"document_id" varchar(256),
	"version_id" bigint,
	"title" text,
	"content" text,
	"content_rich" jsonb,
	"content_markdown" text,
	"anchor" jsonb,
	"anchor_status" varchar(24) DEFAULT 'resolved',
	"tags" text[] DEFAULT '{}',
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_note_links" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_note_id" bigint NOT NULL,
	"target_type" varchar(8) NOT NULL,
	"target_note_id" bigint,
	"target_document_id" varchar(256),
	"target_title" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"company_id" varchar(256),
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_invite_codes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"code" varchar(12) NOT NULL,
	"company_id" bigint NOT NULL,
	"role" varchar(256) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "pdr_ai_v2_invite_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_user_company_memberships" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"company_id" bigint NOT NULL,
	"role" varchar(16) NOT NULL,
	"last_opened_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_users" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" varchar(256) NOT NULL,
	"email" varchar(256) NOT NULL,
	"userId" varchar(256) NOT NULL,
	"company_id" bigint NOT NULL,
	"role" varchar(256) NOT NULL,
	"status" varchar(256) NOT NULL,
	"last_active_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "pdr_ai_v2_users_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_trend_search_jobs" (
	"id" varchar(256) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"status" varchar(50) DEFAULT 'queued' NOT NULL,
	"query" text NOT NULL,
	"company_context" text NOT NULL,
	"categories" jsonb,
	"results" jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_trend_search_cache" (
	"cache_key" varchar(64) PRIMARY KEY NOT NULL,
	"output" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_client_prospector_jobs" (
	"id" varchar(256) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"status" varchar(50) DEFAULT 'queued' NOT NULL,
	"query" text NOT NULL,
	"company_context" text NOT NULL,
	"location_lat" double precision NOT NULL,
	"location_lng" double precision NOT NULL,
	"radius" integer DEFAULT 5000 NOT NULL,
	"categories" jsonb,
	"results" jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_company_metadata" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"schema_version" varchar(20) DEFAULT '1.0.0' NOT NULL,
	"metadata" jsonb NOT NULL,
	"last_extraction_document_id" bigint,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_company_metadata_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"document_id" bigint,
	"change_type" varchar(32) NOT NULL,
	"diff" jsonb NOT NULL,
	"changed_by" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_marketing_content_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"platform" varchar(20) NOT NULL,
	"message" text NOT NULL,
	"angle" varchar(500),
	"content_type" varchar(50) DEFAULT 'post',
	"metadata" jsonb,
	"impressions" integer,
	"engagements" integer,
	"clicks" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_agent_ai_chatbot_document" ADD CONSTRAINT "pdr_ai_v2_agent_ai_chatbot_document_chat_id_pdr_ai_v2_agent_ai_chatbot_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."pdr_ai_v2_agent_ai_chatbot_chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_agent_ai_chatbot_document" ADD CONSTRAINT "pdr_ai_v2_agent_ai_chatbot_document_task_id_pdr_ai_v2_agent_ai_chatbot_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."pdr_ai_v2_agent_ai_chatbot_task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_agent_ai_chatbot_execution_step" ADD CONSTRAINT "pdr_ai_v2_agent_ai_chatbot_execution_step_task_id_pdr_ai_v2_agent_ai_chatbot_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."pdr_ai_v2_agent_ai_chatbot_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_agent_ai_chatbot_memory" ADD CONSTRAINT "pdr_ai_v2_agent_ai_chatbot_memory_chat_id_pdr_ai_v2_agent_ai_chatbot_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."pdr_ai_v2_agent_ai_chatbot_chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_agent_ai_chatbot_message" ADD CONSTRAINT "pdr_ai_v2_agent_ai_chatbot_message_chat_id_pdr_ai_v2_agent_ai_chatbot_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."pdr_ai_v2_agent_ai_chatbot_chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_agent_ai_chatbot_suggestion" ADD CONSTRAINT "pdr_ai_v2_agent_ai_chatbot_suggestion_document_id_document_created_at_pdr_ai_v2_agent_ai_chatbot_document_id_created_at_fk" FOREIGN KEY ("document_id","document_created_at") REFERENCES "public"."pdr_ai_v2_agent_ai_chatbot_document"("id","created_at") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_agent_ai_chatbot_task" ADD CONSTRAINT "pdr_ai_v2_agent_ai_chatbot_task_chat_id_pdr_ai_v2_agent_ai_chatbot_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."pdr_ai_v2_agent_ai_chatbot_chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_agent_ai_chatbot_tool_call" ADD CONSTRAINT "pdr_ai_v2_agent_ai_chatbot_tool_call_message_id_pdr_ai_v2_agent_ai_chatbot_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."pdr_ai_v2_agent_ai_chatbot_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_agent_ai_chatbot_tool_call" ADD CONSTRAINT "pdr_ai_v2_agent_ai_chatbot_tool_call_task_id_pdr_ai_v2_agent_ai_chatbot_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."pdr_ai_v2_agent_ai_chatbot_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_agent_ai_chatbot_vote" ADD CONSTRAINT "pdr_ai_v2_agent_ai_chatbot_vote_chat_id_pdr_ai_v2_agent_ai_chatbot_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."pdr_ai_v2_agent_ai_chatbot_chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_agent_ai_chatbot_vote" ADD CONSTRAINT "pdr_ai_v2_agent_ai_chatbot_vote_message_id_pdr_ai_v2_agent_ai_chatbot_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."pdr_ai_v2_agent_ai_chatbot_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_collab_agent_persona" ADD CONSTRAINT "pdr_ai_v2_collab_agent_persona_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_collab_channel" ADD CONSTRAINT "pdr_ai_v2_collab_channel_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_collab_meeting" ADD CONSTRAINT "pdr_ai_v2_collab_meeting_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_collab_meeting" ADD CONSTRAINT "pdr_ai_v2_collab_meeting_channel_id_pdr_ai_v2_collab_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."pdr_ai_v2_collab_channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_collab_message" ADD CONSTRAINT "pdr_ai_v2_collab_message_channel_id_pdr_ai_v2_collab_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."pdr_ai_v2_collab_channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_collab_node" ADD CONSTRAINT "pdr_ai_v2_collab_node_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_token_accounts" ADD CONSTRAINT "pdr_ai_v2_token_accounts_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_token_grants" ADD CONSTRAINT "pdr_ai_v2_token_grants_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_token_transactions" ADD CONSTRAINT "pdr_ai_v2_token_transactions_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_token_usage_daily" ADD CONSTRAINT "pdr_ai_v2_token_usage_daily_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_chat_history" ADD CONSTRAINT "pdr_ai_v2_chat_history_document_id_pdr_ai_v2_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."pdr_ai_v2_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_reference_resolutions" ADD CONSTRAINT "pdr_ai_v2_document_reference_resolutions_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_views" ADD CONSTRAINT "pdr_ai_v2_document_views_document_id_pdr_ai_v2_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."pdr_ai_v2_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_views" ADD CONSTRAINT "pdr_ai_v2_document_views_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_generated_documents" ADD CONSTRAINT "pdr_ai_v2_generated_documents_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_predictive_document_analysis_results" ADD CONSTRAINT "pdr_ai_v2_predictive_document_analysis_results_document_id_pdr_ai_v2_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."pdr_ai_v2_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_invite_codes" ADD CONSTRAINT "pdr_ai_v2_invite_codes_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_user_company_memberships" ADD CONSTRAINT "pdr_ai_v2_user_company_memberships_user_id_pdr_ai_v2_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."pdr_ai_v2_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_user_company_memberships" ADD CONSTRAINT "pdr_ai_v2_user_company_memberships_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_users" ADD CONSTRAINT "pdr_ai_v2_users_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_trend_search_jobs" ADD CONSTRAINT "pdr_ai_v2_trend_search_jobs_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_client_prospector_jobs" ADD CONSTRAINT "pdr_ai_v2_client_prospector_jobs_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_company_metadata" ADD CONSTRAINT "pdr_ai_v2_company_metadata_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_company_metadata" ADD CONSTRAINT "pdr_ai_v2_company_metadata_last_extraction_document_id_pdr_ai_v2_document_id_fk" FOREIGN KEY ("last_extraction_document_id") REFERENCES "public"."pdr_ai_v2_document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_company_metadata_history" ADD CONSTRAINT "pdr_ai_v2_company_metadata_history_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_company_metadata_history" ADD CONSTRAINT "pdr_ai_v2_company_metadata_history_document_id_pdr_ai_v2_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."pdr_ai_v2_document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_execution_step_task_step_idx" ON "pdr_ai_v2_agent_ai_chatbot_execution_step" USING btree ("task_id","step_number");--> statement-breakpoint
CREATE INDEX "agent_memory_chat_idx" ON "pdr_ai_v2_agent_ai_chatbot_memory" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "agent_memory_chat_type_idx" ON "pdr_ai_v2_agent_ai_chatbot_memory" USING btree ("chat_id","memory_type");--> statement-breakpoint
CREATE UNIQUE INDEX "collab_persona_company_key_idx" ON "pdr_ai_v2_collab_agent_persona" USING btree ("company_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "collab_channel_company_slug_idx" ON "pdr_ai_v2_collab_channel" USING btree ("company_id","slug");--> statement-breakpoint
CREATE INDEX "collab_channel_company_idx" ON "pdr_ai_v2_collab_channel" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "collab_meeting_company_idx" ON "pdr_ai_v2_collab_meeting" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "collab_meeting_channel_idx" ON "pdr_ai_v2_collab_meeting" USING btree ("channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collab_message_channel_seq_idx" ON "pdr_ai_v2_collab_message" USING btree ("channel_id","seq");--> statement-breakpoint
CREATE INDEX "collab_message_channel_created_idx" ON "pdr_ai_v2_collab_message" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE INDEX "collab_node_company_idx" ON "pdr_ai_v2_collab_node" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "token_accounts_company_id_idx" ON "pdr_ai_v2_token_accounts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "token_grants_company_id_idx" ON "pdr_ai_v2_token_grants" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "token_tx_company_created_idx" ON "pdr_ai_v2_token_transactions" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "token_tx_company_service_idx" ON "pdr_ai_v2_token_transactions" USING btree ("company_id","service","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "token_usage_daily_company_date_service_idx" ON "pdr_ai_v2_token_usage_daily" USING btree ("company_id","date","service");--> statement-breakpoint
CREATE INDEX "chat_history_user_id_idx" ON "pdr_ai_v2_chat_history" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chat_history_user_id_created_at_idx" ON "pdr_ai_v2_chat_history" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_history_document_id_idx" ON "pdr_ai_v2_chat_history" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_reference_resolutions_company_ref_idx" ON "pdr_ai_v2_document_reference_resolutions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "document_views_document_id_idx" ON "pdr_ai_v2_document_views" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_views_company_id_idx" ON "pdr_ai_v2_document_views" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "document_views_user_id_idx" ON "pdr_ai_v2_document_views" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "document_views_company_id_viewed_at_idx" ON "pdr_ai_v2_document_views" USING btree ("company_id","viewed_at");--> statement-breakpoint
CREATE INDEX "generated_documents_user_id_idx" ON "pdr_ai_v2_generated_documents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "generated_documents_company_id_idx" ON "pdr_ai_v2_generated_documents" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "generated_documents_company_user_idx" ON "pdr_ai_v2_generated_documents" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX "predictive_analysis_document_id_idx" ON "pdr_ai_v2_predictive_document_analysis_results" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "doc_note_emb_note_id_idx" ON "pdr_ai_v2_document_note_embeddings" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "doc_note_emb_user_id_idx" ON "pdr_ai_v2_document_note_embeddings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "doc_note_emb_document_id_idx" ON "pdr_ai_v2_document_note_embeddings" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "doc_note_emb_company_id_idx" ON "pdr_ai_v2_document_note_embeddings" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "doc_note_emb_embedding_short_idx" ON "pdr_ai_v2_document_note_embeddings" USING hnsw ("embedding_short" vector_cosine_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
CREATE INDEX "document_notes_user_idx" ON "pdr_ai_v2_document_notes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "document_notes_document_idx" ON "pdr_ai_v2_document_notes" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_notes_company_idx" ON "pdr_ai_v2_document_notes" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "document_notes_version_idx" ON "pdr_ai_v2_document_notes" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "document_notes_anchor_status_idx" ON "pdr_ai_v2_document_notes" USING btree ("anchor_status");--> statement-breakpoint
CREATE INDEX "note_links_source_idx" ON "pdr_ai_v2_note_links" USING btree ("source_note_id");--> statement-breakpoint
CREATE INDEX "note_links_target_note_idx" ON "pdr_ai_v2_note_links" USING btree ("target_note_id");--> statement-breakpoint
CREATE INDEX "note_links_target_document_idx" ON "pdr_ai_v2_note_links" USING btree ("target_document_id");--> statement-breakpoint
CREATE INDEX "note_links_company_title_idx" ON "pdr_ai_v2_note_links" USING btree ("company_id","target_title");--> statement-breakpoint
CREATE INDEX "invite_codes_code_idx" ON "pdr_ai_v2_invite_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "invite_codes_company_id_idx" ON "pdr_ai_v2_invite_codes" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_company_memberships_user_company_unique" ON "pdr_ai_v2_user_company_memberships" USING btree ("user_id","company_id");--> statement-breakpoint
CREATE INDEX "user_company_memberships_user_id_idx" ON "pdr_ai_v2_user_company_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_company_memberships_company_id_idx" ON "pdr_ai_v2_user_company_memberships" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "users_company_id_idx" ON "pdr_ai_v2_users" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "users_user_id_idx" ON "pdr_ai_v2_users" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "trend_search_jobs_company_id_idx" ON "pdr_ai_v2_trend_search_jobs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "trend_search_jobs_status_idx" ON "pdr_ai_v2_trend_search_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "trend_search_jobs_company_status_idx" ON "pdr_ai_v2_trend_search_jobs" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "client_prospector_jobs_company_id_idx" ON "pdr_ai_v2_client_prospector_jobs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "client_prospector_jobs_status_idx" ON "pdr_ai_v2_client_prospector_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "client_prospector_jobs_company_status_idx" ON "pdr_ai_v2_client_prospector_jobs" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "company_metadata_company_id_unique" ON "pdr_ai_v2_company_metadata" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "company_metadata_history_company_id_idx" ON "pdr_ai_v2_company_metadata_history" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "company_metadata_history_document_id_idx" ON "pdr_ai_v2_company_metadata_history" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "company_metadata_history_created_at_idx" ON "pdr_ai_v2_company_metadata_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "company_metadata_history_change_type_idx" ON "pdr_ai_v2_company_metadata_history" USING btree ("change_type");--> statement-breakpoint
CREATE INDEX "mch_company_id_idx" ON "pdr_ai_v2_marketing_content_history" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "mch_platform_idx" ON "pdr_ai_v2_marketing_content_history" USING btree ("platform");