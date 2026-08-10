/**
 * HTTP contract for `services/transcription` (ADR-004).
 *
 * Field names are snake_case because this is the FastAPI wire format the
 * existing sidecar already speaks; the split service keeps it byte-for-byte
 * so TypeScript callers migrate by changing only the base URL.
 */
import { z } from "zod";

/** One timestamped span of the transcript — the citation anchor unit for audio/video. */
export const transcriptSegmentSchema = z.object({
  /** Segment start, seconds from media start. */
  start: z.number().min(0),
  /** Segment end, seconds from media start. */
  end: z.number().min(0),
  text: z.string(),
});
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;

/** `POST /transcribe` (multipart file upload) response. */
export const transcribeResponseSchema = z.object({
  text: z.string(),
  language: z.string(),
  /**
   * Whisper-reported confidence in [0,1] derived from segment
   * average log-probabilities — model-reported, not fabricated.
   */
  confidence: z.number().min(0).max(1),
  filename: z.string(),
  segments: z.array(transcriptSegmentSchema),
});
export type TranscribeResponse = z.infer<typeof transcribeResponseSchema>;

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
export type VideoTranscribeResponse = z.infer<
  typeof videoTranscribeResponseSchema
>;
