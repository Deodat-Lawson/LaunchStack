/**
 * Wire contract for video transcription — `POST /download-and-transcribe`
 * on `services/transcription` (ADR-004): yt-dlp download, then local
 * transcription. Shares the backing service with audio-transcription; the
 * contract is split here so each folder owns its own conversation.
 */
import { z } from "zod";

/** `POST /download-and-transcribe` request. */
export const videoTranscribeRequestSchema = z.object({
    url: z.string().url(),
    /** Max media duration in seconds to download; 0 disables the guard. */
    max_duration: z.number().int().min(0).default(7200),
});
export type VideoTranscribeRequest = z.infer<typeof videoTranscribeRequestSchema>;

/** `POST /download-and-transcribe` response. */
export const videoTranscribeResponseSchema = z.object({
    text: z.string(),
    language: z.string(),
    confidence: z.number().min(0).max(1),
    title: z.string(),
    duration: z.number().nullable(),
    source_url: z.string(),
});
export type VideoTranscribeResponse = z.infer<typeof videoTranscribeResponseSchema>;
