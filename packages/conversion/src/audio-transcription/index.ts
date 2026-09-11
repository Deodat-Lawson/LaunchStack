/**
 * Audio transcription: `audio file or URL → timestamped transcript document`.
 * Detection, the wire contract, the typed client for services/transcription,
 * and the provider selection (Gemini, or the self-hosted service).
 */
export * from "./wire";
export * from "./transcribe";
export { HttpTranscriptionClient, type TranscriptionClientConfig } from "./client";
export { getTranscriptionProvider, type TranscriptionProvider } from "./providers";
