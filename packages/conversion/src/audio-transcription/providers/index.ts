import type { ProviderResult } from "@launchstack/llm/providers";
import { resolveTranscriptionProvider } from "@launchstack/llm/providers/registry";

export interface TranscriptionResult {
    text: string;
    /** Main spoken language as a BCP-47 code ("en", "yue"), or "unknown". */
    language: string;
    /** Every language heard, main one first, when the provider reports them. */
    languages?: string[];
    confidence: number;
    durationSeconds?: number;
    /** Timestamped spans, when the provider reports them (Whisper and native Gemini do). */
    segments?: { start: number; end: number; text: string }[];
}

export interface TranscribeOptions {
    /** The type the uploader's browser reported; the file name decides first. */
    mimeType?: string;
    /** false: words only, one quick call (dictation). Default true. */
    timestamps?: boolean;
}

export interface TranscriptionProvider {
    name: string;
    transcribe(
        audioBuffer: Buffer,
        filename: string,
        options?: TranscribeOptions
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
        // Cloud transcription defaults to Gemini (its native API; see
        // ./gemini-native). Override with TRANSCRIPTION_API_BASE_URL /
        // TRANSCRIPTION_API_KEY / TRANSCRIPTION_MODEL.
        const { GeminiTranscriptionProvider } = await import("./gemini");
        _provider = new GeminiTranscriptionProvider();
    }

    return _provider;
}
