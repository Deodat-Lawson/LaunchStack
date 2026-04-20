import type { ProviderResult } from "../types";
import type { TranscriptionProvider, TranscriptionResult } from "./index";
import { transcriptionTokens } from "~/lib/credits/costs";
import OpenAI from "openai";

export class OpenAIWhisperProvider implements TranscriptionProvider {
    name = "openai";
    private client: OpenAI;

    constructor() {
        this.client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY || process.env.AI_API_KEY,
            ...(process.env.AI_BASE_URL ? { baseURL: process.env.AI_BASE_URL } : {}),
        });
    }

    async transcribe(
        audioBuffer: Buffer,
        filename: string
    ): Promise<ProviderResult<TranscriptionResult>> {
        const file = new File([new Uint8Array(audioBuffer)], filename, {
            type: "application/octet-stream",
        });

        const response = await this.client.audio.transcriptions.create({
            model: "whisper-1",
            file,
            response_format: "verbose_json",
        });

        const durationSeconds = response.duration ?? 0;
        const tokens = transcriptionTokens(durationSeconds);

        return {
            data: {
                text: response.text,
                language: response.language ?? "unknown",
                confidence: 0.92, // OpenAI Whisper is high quality
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
