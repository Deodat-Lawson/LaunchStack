import type { ProviderResult } from "@launchstack/core/providers";
import { resolveTranscriptionProvider } from "@launchstack/core/providers/registry";

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
        // Cloud transcription runs on the same OpenAI-compatible endpoint as
        // the rest of the deployment, defaulting to Gemini. Override with
        // TRANSCRIPTION_API_BASE_URL / TRANSCRIPTION_API_KEY / TRANSCRIPTION_MODEL.
        const { GeminiTranscriptionProvider } = await import("./gemini");
        _provider = new GeminiTranscriptionProvider();
    }

    return _provider;
}
