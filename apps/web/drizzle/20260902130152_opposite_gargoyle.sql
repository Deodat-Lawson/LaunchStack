DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "pdr_ai_v2_call_notes_calls" LIMIT 1) THEN
        RAISE EXCEPTION 'Call Notes v2 cannot relabel existing Zoom evidence as local microphone capture; export or remove existing Call Notes data before migrating';
    END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_captures" DROP CONSTRAINT "pdr_ai_v2_call_notes_captures_capture_user_connection_id_pdr_ai_v2_call_notes_zoom_connections_id_fk";--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_calls" RENAME COLUMN "provider" TO "source";--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_calls" RENAME COLUMN "provider_occurrence_key" TO "source_occurrence_key";--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_capture_attempts" RENAME COLUMN "provider_attempt_key" TO "source_attempt_key";--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_capture_attempts" RENAME COLUMN "provider_stream_key" TO "source_stream_key";--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_participants" RENAME COLUMN "provider_participant_key" TO "source_participant_key";--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_participants" RENAME COLUMN "provider_session_key" TO "source_session_key";--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_transcript_segments" RENAME COLUMN "provider_start_ms" TO "source_start_ms";--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_transcript_segments" RENAME COLUMN "provider_end_ms" TO "source_end_ms";--> statement-breakpoint
DROP INDEX "call_notes_calls_company_occurrence_unique";--> statement-breakpoint
DROP INDEX "call_notes_capture_attempts_capture_provider_key_unique";--> statement-breakpoint
DROP INDEX "call_notes_participants_attempt_key_idx";--> statement-breakpoint
DROP INDEX "call_notes_segments_call_order_idx";--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_captures" ADD COLUMN "capture_user_id" varchar(256) NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "call_notes_calls_company_source_occurrence_unique" ON "pdr_ai_v2_call_notes_calls" USING btree ("company_id","source","source_occurrence_key");--> statement-breakpoint
CREATE UNIQUE INDEX "call_notes_capture_attempts_capture_source_key_unique" ON "pdr_ai_v2_call_notes_capture_attempts" USING btree ("capture_id","source_attempt_key");--> statement-breakpoint
CREATE INDEX "call_notes_participants_attempt_key_idx" ON "pdr_ai_v2_call_notes_participants" USING btree ("attempt_id","source_participant_key");--> statement-breakpoint
CREATE INDEX "call_notes_segments_call_order_idx" ON "pdr_ai_v2_call_notes_transcript_segments" USING btree ("call_id","source_start_ms","receive_order");--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_captures" DROP COLUMN "capture_user_connection_id";--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_captures" DROP COLUMN "capture_user_provider_key";--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_transcript_segments" DROP COLUMN "provider_event_key";--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_zoom_connections" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "pdr_ai_v2_call_notes_zoom_connections";