import type { ProviderResult } from "../types";
import type { TranscriptionProvider, TranscriptionResult } from "./index";
import { transcriptionTokens } from "~/lib/credits/costs";
import { resolveBaseUrl, resolveApiKey, resolveModel } from "../registry";

/**
 * OpenAI-compatible transcription provider.
 * Works with Groq, OpenAI, and any provider that supports
 * POST /v1/audio/transcriptions with multipart form data.
 */
export class OpenAICompatibleTranscriptionProvider implements TranscriptionProvider {
    name: string;
    private baseUrl: string;
    private apiKey: string;
    private model: string;

    constructor() {
        this.baseUrl = resolveBaseUrl(
            process.env.TRANSCRIPTION_API_BASE_URL,
            "https://api.groq.com/openai/v1",
        );
        this.apiKey = resolveApiKey(
            process.env.TRANSCRIPTION_API_KEY,
            process.env.GROQ_API_KEY,
            process.env.OPENAI_API_KEY,
        );
        this.model = resolveModel(
            process.env.TRANSCRIPTION_MODEL,
            "whisper-large-v3-turbo",
        );
        this.name = `transcription:${this.model}`;

        if (!this.apiKey) {
            console.warn("[Transcription] No API key found (TRANSCRIPTION_API_KEY / AI_API_KEY / GROQ_API_KEY)");
        }
    }

    async transcribe(
        audioBuffer: Buffer,
        filename: string
    ): Promise<ProviderResult<TranscriptionResult>> {
        const formData = new FormData();
        const blob = new Blob([new Uint8Array(audioBuffer)], { type: "application/octet-stream" });
        formData.append("file", blob, filename);
        formData.append("model", this.model);
        formData.append("response_format", "verbose_json");

        const resp = await fetch(`${this.baseUrl}/audio/transcriptions`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: formData as any,
        });

        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`Transcription failed (${resp.status}): ${text}`);
        }

        const data = (await resp.json()) as {
            text: string;
            language?: string;
            duration?: number;
        };

        const durationSeconds = data.duration ?? 0;
        const tokens = transcriptionTokens(durationSeconds);

        return {
            data: {
                text: data.text,
                language: data.language ?? "unknown",
                confidence: 0.9,
                durationSeconds,
            },
            usage: {
                tokensUsed: tokens,
                details: {
                    durationSeconds,
                    estimatedMinutes: Math.ceil(durationSeconds / 60),
                },
            },
        };
    }
}
