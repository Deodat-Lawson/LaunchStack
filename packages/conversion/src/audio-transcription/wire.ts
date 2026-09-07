/**
 * Wire contract for audio transcription — `POST /transcribe` on
 * `services/transcription` (ADR-004).
 *
 * Field names are snake_case because this is the FastAPI wire format the
 * service speaks. The schema generator publishes this contract for the
 * Python side's contract tests; it may import zod and nothing else.
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
