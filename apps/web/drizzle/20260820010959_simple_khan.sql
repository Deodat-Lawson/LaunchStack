CREATE TABLE "pdr_ai_v2_call_notes_bookmarks" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"call_id" varchar(64) NOT NULL,
	"segment_id" varchar(64) NOT NULL,
	"company_id" bigint NOT NULL,
	"created_by_user_id" varchar(256) NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_call_notes_calls" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_occurrence_key" varchar(256) NOT NULL,
	"title" varchar(512) NOT NULL,
	"status" varchar(32) DEFAULT 'detected' NOT NULL,
	"document_note_id" bigint,
	"note_owner_user_id" varchar(256),
	"note_visibility" varchar(16) DEFAULT 'company' NOT NULL,
	"knowledge_included" boolean DEFAULT false NOT NULL,
	"current_note_revision" integer DEFAULT 0 NOT NULL,
	"failure_code" varchar(128),
	"failure_message" varchar(1024),
	"started_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_call_notes_capture_attempts" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"capture_id" varchar(64) NOT NULL,
	"call_id" varchar(64) NOT NULL,
	"company_id" bigint NOT NULL,
	"provider_attempt_key" varchar(256) NOT NULL,
	"provider_stream_key" varchar(256),
	"lifecycle" varchar(24) DEFAULT 'connecting' NOT NULL,
	"lease_token" varchar(128),
	"lease_owner" varchar(256),
	"lease_expires_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"ended_at" timestamp with time zone,
	"failure_code" varchar(128),
	"failure_message" varchar(1024)
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_call_notes_captures" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"call_id" varchar(64) NOT NULL,
	"company_id" bigint NOT NULL,
	"capture_user_connection_id" varchar(64) NOT NULL,
	"capture_user_provider_key" varchar(256) NOT NULL,
	"desired_mode" varchar(16) DEFAULT 'running' NOT NULL,
	"lifecycle" varchar(32) DEFAULT 'connecting' NOT NULL,
	"outcome" varchar(16),
	"active_attempt_id" varchar(64),
	"started_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"ended_at" timestamp with time zone,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_call_notes_enrichment_runs" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"call_id" varchar(64) NOT NULL,
	"company_id" bigint NOT NULL,
	"requested_by_user_id" varchar(256) NOT NULL,
	"base_note_revision" integer NOT NULL,
	"transcript_fingerprint" varchar(64) NOT NULL,
	"status" varchar(24) DEFAULT 'queued' NOT NULL,
	"original_output" jsonb,
	"editable_proposal" jsonb,
	"model_metadata" jsonb,
	"error_code" varchar(128),
	"error_message" varchar(1024),
	"resolved_by_user_id" varchar(256),
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"generated_at" timestamp with time zone,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_call_notes_gaps" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"call_id" varchar(64) NOT NULL,
	"capture_id" varchar(64) NOT NULL,
	"attempt_id" varchar(64),
	"company_id" bigint NOT NULL,
	"kind" varchar(32) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_call_notes_note_revisions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"call_id" varchar(64) NOT NULL,
	"company_id" bigint NOT NULL,
	"document_note_id" bigint NOT NULL,
	"revision" integer NOT NULL,
	"origin" varchar(24) NOT NULL,
	"enrichment_run_id" varchar(64),
	"title" text,
	"content_markdown" text NOT NULL,
	"content_rich" jsonb NOT NULL,
	"created_by_user_id" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_call_notes_participants" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"call_id" varchar(64) NOT NULL,
	"attempt_id" varchar(64) NOT NULL,
	"company_id" bigint NOT NULL,
	"provider_participant_key" varchar(256) NOT NULL,
	"provider_session_key" varchar(256),
	"display_name" varchar(512) NOT NULL,
	"observed_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"left_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_call_notes_transcript_segments" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"call_id" varchar(64) NOT NULL,
	"attempt_id" varchar(64) NOT NULL,
	"participant_id" varchar(64),
	"company_id" bigint NOT NULL,
	"provider_event_key" varchar(256),
	"source_packet_hash" varchar(64) NOT NULL,
	"source_kind" varchar(32) NOT NULL,
	"speaker_name" varchar(512),
	"provider_start_ms" bigint,
	"provider_end_ms" bigint,
	"received_at" timestamp with time zone NOT NULL,
	"receive_order" integer NOT NULL,
	"text" text NOT NULL,
	"language" varchar(32),
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_call_notes_work_items" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"call_id" varchar(64),
	"capture_id" varchar(64),
	"kind" varchar(32) NOT NULL,
	"idempotency_key" varchar(256) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"lease_token" varchar(128),
	"lease_owner" varchar(256),
	"lease_expires_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_code" varchar(128),
	"error_message" varchar(1024),
	"available_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_call_notes_zoom_connections" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"zoom_account_id" varchar(256) NOT NULL,
	"zoom_user_id" varchar(256) NOT NULL,
	"encrypted_access_token" text NOT NULL,
	"encrypted_refresh_token" text,
	"token_expires_at" timestamp with time zone,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"status" varchar(24) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_bookmarks" ADD CONSTRAINT "pdr_ai_v2_call_notes_bookmarks_call_id_pdr_ai_v2_call_notes_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."pdr_ai_v2_call_notes_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_bookmarks" ADD CONSTRAINT "pdr_ai_v2_call_notes_bookmarks_segment_id_pdr_ai_v2_call_notes_transcript_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."pdr_ai_v2_call_notes_transcript_segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_bookmarks" ADD CONSTRAINT "pdr_ai_v2_call_notes_bookmarks_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_calls" ADD CONSTRAINT "pdr_ai_v2_call_notes_calls_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_capture_attempts" ADD CONSTRAINT "pdr_ai_v2_call_notes_capture_attempts_capture_id_pdr_ai_v2_call_notes_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."pdr_ai_v2_call_notes_captures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_capture_attempts" ADD CONSTRAINT "pdr_ai_v2_call_notes_capture_attempts_call_id_pdr_ai_v2_call_notes_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."pdr_ai_v2_call_notes_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_capture_attempts" ADD CONSTRAINT "pdr_ai_v2_call_notes_capture_attempts_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_captures" ADD CONSTRAINT "pdr_ai_v2_call_notes_captures_call_id_pdr_ai_v2_call_notes_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."pdr_ai_v2_call_notes_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_captures" ADD CONSTRAINT "pdr_ai_v2_call_notes_captures_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_captures" ADD CONSTRAINT "pdr_ai_v2_call_notes_captures_capture_user_connection_id_pdr_ai_v2_call_notes_zoom_connections_id_fk" FOREIGN KEY ("capture_user_connection_id") REFERENCES "public"."pdr_ai_v2_call_notes_zoom_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_enrichment_runs" ADD CONSTRAINT "pdr_ai_v2_call_notes_enrichment_runs_call_id_pdr_ai_v2_call_notes_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."pdr_ai_v2_call_notes_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_enrichment_runs" ADD CONSTRAINT "pdr_ai_v2_call_notes_enrichment_runs_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_gaps" ADD CONSTRAINT "pdr_ai_v2_call_notes_gaps_call_id_pdr_ai_v2_call_notes_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."pdr_ai_v2_call_notes_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_gaps" ADD CONSTRAINT "pdr_ai_v2_call_notes_gaps_capture_id_pdr_ai_v2_call_notes_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."pdr_ai_v2_call_notes_captures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_gaps" ADD CONSTRAINT "pdr_ai_v2_call_notes_gaps_attempt_id_pdr_ai_v2_call_notes_capture_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."pdr_ai_v2_call_notes_capture_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_gaps" ADD CONSTRAINT "pdr_ai_v2_call_notes_gaps_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_note_revisions" ADD CONSTRAINT "pdr_ai_v2_call_notes_note_revisions_call_id_pdr_ai_v2_call_notes_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."pdr_ai_v2_call_notes_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_note_revisions" ADD CONSTRAINT "pdr_ai_v2_call_notes_note_revisions_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_note_revisions" ADD CONSTRAINT "pdr_ai_v2_call_notes_note_revisions_enrichment_run_id_pdr_ai_v2_call_notes_enrichment_runs_id_fk" FOREIGN KEY ("enrichment_run_id") REFERENCES "public"."pdr_ai_v2_call_notes_enrichment_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_participants" ADD CONSTRAINT "pdr_ai_v2_call_notes_participants_call_id_pdr_ai_v2_call_notes_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."pdr_ai_v2_call_notes_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_participants" ADD CONSTRAINT "pdr_ai_v2_call_notes_participants_attempt_id_pdr_ai_v2_call_notes_capture_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."pdr_ai_v2_call_notes_capture_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_participants" ADD CONSTRAINT "pdr_ai_v2_call_notes_participants_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_transcript_segments" ADD CONSTRAINT "pdr_ai_v2_call_notes_transcript_segments_call_id_pdr_ai_v2_call_notes_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."pdr_ai_v2_call_notes_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_transcript_segments" ADD CONSTRAINT "pdr_ai_v2_call_notes_transcript_segments_attempt_id_pdr_ai_v2_call_notes_capture_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."pdr_ai_v2_call_notes_capture_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_transcript_segments" ADD CONSTRAINT "pdr_ai_v2_call_notes_transcript_segments_participant_id_pdr_ai_v2_call_notes_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."pdr_ai_v2_call_notes_participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_transcript_segments" ADD CONSTRAINT "pdr_ai_v2_call_notes_transcript_segments_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_work_items" ADD CONSTRAINT "pdr_ai_v2_call_notes_work_items_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_work_items" ADD CONSTRAINT "pdr_ai_v2_call_notes_work_items_call_id_pdr_ai_v2_call_notes_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."pdr_ai_v2_call_notes_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_work_items" ADD CONSTRAINT "pdr_ai_v2_call_notes_work_items_capture_id_pdr_ai_v2_call_notes_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."pdr_ai_v2_call_notes_captures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_zoom_connections" ADD CONSTRAINT "pdr_ai_v2_call_notes_zoom_connections_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_notes_bookmarks_call_created_idx" ON "pdr_ai_v2_call_notes_bookmarks" USING btree ("call_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "call_notes_calls_company_occurrence_unique" ON "pdr_ai_v2_call_notes_calls" USING btree ("company_id","provider","provider_occurrence_key");--> statement-breakpoint
CREATE INDEX "call_notes_calls_company_created_at_idx" ON "pdr_ai_v2_call_notes_calls" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "call_notes_calls_company_status_idx" ON "pdr_ai_v2_call_notes_calls" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "call_notes_calls_document_note_unique" ON "pdr_ai_v2_call_notes_calls" USING btree ("document_note_id");--> statement-breakpoint
CREATE UNIQUE INDEX "call_notes_capture_attempts_capture_provider_key_unique" ON "pdr_ai_v2_call_notes_capture_attempts" USING btree ("capture_id","provider_attempt_key");--> statement-breakpoint
CREATE INDEX "call_notes_capture_attempts_capture_started_idx" ON "pdr_ai_v2_call_notes_capture_attempts" USING btree ("capture_id","started_at");--> statement-breakpoint
CREATE INDEX "call_notes_capture_attempts_lease_idx" ON "pdr_ai_v2_call_notes_capture_attempts" USING btree ("lifecycle","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "call_notes_captures_call_unique" ON "pdr_ai_v2_call_notes_captures" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "call_notes_captures_company_lifecycle_idx" ON "pdr_ai_v2_call_notes_captures" USING btree ("company_id","lifecycle");--> statement-breakpoint
CREATE INDEX "call_notes_enrichment_runs_call_created_idx" ON "pdr_ai_v2_call_notes_enrichment_runs" USING btree ("call_id","created_at");--> statement-breakpoint
CREATE INDEX "call_notes_enrichment_runs_company_status_idx" ON "pdr_ai_v2_call_notes_enrichment_runs" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "call_notes_gaps_call_started_idx" ON "pdr_ai_v2_call_notes_gaps" USING btree ("call_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "call_notes_note_revisions_call_revision_unique" ON "pdr_ai_v2_call_notes_note_revisions" USING btree ("call_id","revision");--> statement-breakpoint
CREATE INDEX "call_notes_note_revisions_document_note_idx" ON "pdr_ai_v2_call_notes_note_revisions" USING btree ("document_note_id");--> statement-breakpoint
CREATE INDEX "call_notes_participants_attempt_key_idx" ON "pdr_ai_v2_call_notes_participants" USING btree ("attempt_id","provider_participant_key");--> statement-breakpoint
CREATE INDEX "call_notes_participants_call_observed_idx" ON "pdr_ai_v2_call_notes_participants" USING btree ("call_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "call_notes_segments_attempt_packet_unique" ON "pdr_ai_v2_call_notes_transcript_segments" USING btree ("attempt_id","source_packet_hash");--> statement-breakpoint
CREATE INDEX "call_notes_segments_call_order_idx" ON "pdr_ai_v2_call_notes_transcript_segments" USING btree ("call_id","provider_start_ms","receive_order");--> statement-breakpoint
CREATE INDEX "call_notes_segments_company_received_idx" ON "pdr_ai_v2_call_notes_transcript_segments" USING btree ("company_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "call_notes_work_items_company_kind_key_unique" ON "pdr_ai_v2_call_notes_work_items" USING btree ("company_id","kind","idempotency_key");--> statement-breakpoint
CREATE INDEX "call_notes_work_items_claim_idx" ON "pdr_ai_v2_call_notes_work_items" USING btree ("status","available_at","lease_expires_at");--> statement-breakpoint
CREATE INDEX "call_notes_work_items_call_created_idx" ON "pdr_ai_v2_call_notes_work_items" USING btree ("call_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "call_notes_zoom_connections_company_user_unique" ON "pdr_ai_v2_call_notes_zoom_connections" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "call_notes_zoom_connections_company_zoom_user_unique" ON "pdr_ai_v2_call_notes_zoom_connections" USING btree ("company_id","zoom_user_id");