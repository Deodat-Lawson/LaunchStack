import type { ProviderResult } from "@launchstack/core/providers";
import type { TranscriptionProvider, TranscriptionResult } from "./index";
import {
    resolveBaseUrl,
    resolveApiKey,
    resolveModel,
} from "@launchstack/core/providers/registry";
import { GEMINI_DEFAULT_MODEL } from "@launchstack/core/llm/types";

/** Transcription is billed per minute. 5000 tokens/minute matches the
 *  historical TOKEN_COSTS.transcription rate; callers that need a
 *  different billing ratio can wrap this provider. */
const TRANSCRIPTION_TOKENS_PER_MINUTE = 5000;
function transcriptionTokens(durationSeconds: number): number {
    const minutes = Math.max(1, Math.ceil(durationSeconds / 60));
    return minutes * TRANSCRIPTION_TOKENS_PER_MINUTE;
}

/**
 * Audio formats Gemini accepts. Notably absent: WebM/Opus, which is what
 * `MediaRecorder` produces in every Chromium and Firefox browser — callers are
 * expected to convert before arriving here (see `lib/voice/encodeWav.ts`).
 */
const SUPPORTED_EXTENSIONS: Record<string, string> = {
    wav: "wav",
    mp3: "mp3",
    aiff: "aiff",
    aac: "aac",
    ogg: "ogg",
    flac: "flac",
};

const PROMPT =
    "Transcribe this audio verbatim. Reply with the transcript text only — " +
    "no preamble, no commentary, no quotation marks. If there is no " +
    "intelligible speech, reply with nothing at all.";

/**
 * Transcription via Gemini's audio understanding.
 *
 * There is no `/audio/transcriptions` endpoint anywhere in Google's stack, so
 * this is not a repointed Whisper client: audio goes in as an `input_audio`
 * content part on an ordinary `/chat/completions` call, and the transcript
 * comes back as chat text. That keeps transcription on the same
 * OpenAI-compatible endpoint as everything else in the deployment.
 *
 * The trade-off is that the response carries no `language`, `duration` or
 * per-word confidence the way Whisper's `verbose_json` did. Those fields are
 * reported honestly below rather than invented.
 */
export class GeminiTranscriptionProvider implements TranscriptionProvider {
    name: string;
    private baseUrl: string;
    private apiKey: string;
    private model: string;

    constructor() {
        this.baseUrl = resolveBaseUrl(process.env.TRANSCRIPTION_API_BASE_URL);
        this.apiKey = resolveApiKey(
            process.env.TRANSCRIPTION_API_KEY,
            process.env.GOOGLE_AI_API_KEY,
        );
        this.model = resolveModel(
            process.env.TRANSCRIPTION_MODEL,
            GEMINI_DEFAULT_MODEL,
        );
        this.name = `transcription:${this.model}`;

        if (!this.apiKey) {
            console.warn(
                "[Transcription] No API key found. Set GOOGLE_AI_API_KEY, or " +
                "TRANSCRIPTION_API_KEY alongside TRANSCRIPTION_API_BASE_URL.",
            );
        }
    }

    async transcribe(
        audioBuffer: Buffer,
        filename: string,
        durationSeconds = 0,
    ): Promise<ProviderResult<TranscriptionResult>> {
        const extension = filename.split(".").pop()?.toLowerCase() ?? "";
        const format = SUPPORTED_EXTENSIONS[extension];
        if (!format) {
            throw new Error(
                `Unsupported audio format ".${extension}" for transcription. ` +
                `Gemini accepts ${Object.keys(SUPPORTED_EXTENSIONS).join(", ")} — ` +
                "convert before uploading.",
            );
        }

        const resp = await fetch(`${this.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: this.model,
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: PROMPT },
                            {
                                type: "input_audio",
                                input_audio: {
                                    data: audioBuffer.toString("base64"),
                                    format,
                                },
                            },
                        ],
                    },
                ],
            }),
        });

        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`Transcription failed (${resp.status}): ${text}`);
        }

        const data = (await resp.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
            usage?: { total_tokens?: number };
        };

        const text = data.choices?.[0]?.message?.content?.trim() ?? "";
        const tokens = data.usage?.total_tokens ?? transcriptionTokens(durationSeconds);

        return {
            data: {
                text,
                // The chat surface reports neither the spoken language nor a
                // confidence score. Saying "unknown" is more useful than a
                // number chosen to look like Whisper's.
                language: "unknown",
                confidence: 0,
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
