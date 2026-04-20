import type { ProviderResult } from "../types";
import { resolveTranscriptionProvider } from "../registry";

export interface TranscriptionResult {
    text: string;
    language: string;
    confidence: number;
    durationSeconds?: number;
}

export interface TranscriptionProvider {
    name: string;
    transcribe(
        audioBuffer: Buffer,
        filename: string
    ): Promise<ProviderResult<TranscriptionResult>>;
}

let _provider: TranscriptionProvider | null = null;

export async function getTranscriptionProvider(): Promise<TranscriptionProvider> {
    if (_provider) return _provider;

    const type = resolveTranscriptionProvider();
    if (type === "sidecar") {
        const { SidecarTranscriptionProvider } = await import("./sidecar");
        _provider = new SidecarTranscriptionProvider();
    } else {
        // All cloud providers use the OpenAI-compatible endpoint
        // Configured via TRANSCRIPTION_API_BASE_URL, TRANSCRIPTION_API_KEY, TRANSCRIPTION_MODEL
        const { OpenAICompatibleTranscriptionProvider } = await import("./groq");
        _provider = new OpenAICompatibleTranscriptionProvider();
    }

    return _provider;
}
