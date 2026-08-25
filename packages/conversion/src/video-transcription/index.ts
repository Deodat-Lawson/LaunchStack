/**
 * Video transcription: `video URL → downloaded audio → timestamped transcript`.
 * Owns its own wire contract; shares the backing service with audio-transcription.
 */
export * from "./wire";
export * from "./transcribe";
