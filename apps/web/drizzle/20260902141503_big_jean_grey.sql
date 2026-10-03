ALTER TABLE "pdr_ai_v2_call_notes_transcript_segments" ADD COLUMN "audio_channel" varchar(16) DEFAULT 'microphone' NOT NULL;
ALTER TABLE "pdr_ai_v2_call_notes_transcript_segments" ALTER COLUMN "audio_channel" DROP DEFAULT;
UPDATE "pdr_ai_v2_call_notes_calls" SET "source" = 'local_audio' WHERE "source" = 'local_microphone';