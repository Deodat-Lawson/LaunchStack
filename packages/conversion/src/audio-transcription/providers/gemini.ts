import type { ProviderResult } from "@launchstack/llm/providers";
import type { TranscribeOptions, TranscriptionProvider, TranscriptionResult } from "./index";
import { resolveEndpoint, resolveModel } from "@launchstack/llm/providers/registry";
import { GEMINI_DEFAULT_MODEL } from "@launchstack/llm/types";
import { TranscriptionError } from "../errors";
import { GeminiNativeTranscriber, geminiNativeRoot } from "./gemini-native";

/** Transcription is billed per minute. 5000 tokens/minute matches the
 *  historical TOKEN_COSTS.transcription rate; callers that need a
 *  different billing ratio can wrap this provider. */
const TRANSCRIPTION_TOKENS_PER_MINUTE = 5000;
function transcriptionTokens(durationSeconds: number): number {
    const minutes = Math.max(1, Math.ceil(durationSeconds / 60));
    return minutes * TRANSCRIPTION_TOKENS_PER_MINUTE;
}

/**
 * What an OpenAI-compatible `input_audio` part accepts: wav and mp3, nothing
 * else (OpenAI's schema, and Gemini's compatibility layer enforces the same —
 * it answered every .m4a with `Invalid audio format "aac"`). Only endpoints
 * that are not Google's take this path; Google's goes native.
 */
const COMPAT_FORMATS: Record<string, string> = {
    wav: "wav",
    mp3: "mp3",
};

const PROMPT =
    "Transcribe this audio verbatim in the language spoken. Reply with the transcript text only — " +
    "no preamble, no commentary, no quotation marks. If there is no " +
    "intelligible speech, reply with nothing at all.";

/**
 * Cloud transcription, defaulting to Gemini.
 *
 * On Google's endpoint this uses the native API ({@link GeminiNativeTranscriber}):
 * real container types (m4a, mp4, aac, flac, ogg…), the Files API for large
 * recordings, windowed calls so long meetings are not cut off, and a
 * timestamped transcript with the spoken language.
 *
 * Any other OpenAI-compatible endpoint (TRANSCRIPTION_API_BASE_URL) gets audio
 * as an `input_audio` part on `/chat/completions`, which limits it to wav and
 * mp3 and reports no language or timestamps.
 */
export class GeminiTranscriptionProvider implements TranscriptionProvider {
    name: string;
    private baseUrl: string;
    private apiKey: string;
    private model: string;
    private native: GeminiNativeTranscriber | null;

    constructor() {
        const endpoint = resolveEndpoint(
            process.env.TRANSCRIPTION_API_BASE_URL,
            process.env.TRANSCRIPTION_API_KEY
        );
        this.baseUrl = endpoint.baseUrl;
        this.apiKey = endpoint.apiKey;
        this.model = resolveModel(process.env.TRANSCRIPTION_MODEL, GEMINI_DEFAULT_MODEL);
        this.name = `transcription:${this.model}`;
        const root = geminiNativeRoot(this.baseUrl);
        this.native = root
            ? new GeminiNativeTranscriber({ root, apiKey: this.apiKey, model: this.model })
            : null;

        if (!this.apiKey) {
            console.warn(
                "[Transcription] No API key found. Set GOOGLE_AI_API_KEY, or " +
                    "TRANSCRIPTION_API_KEY alongside TRANSCRIPTION_API_BASE_URL."
            );
        }
    }

    async transcribe(
        audioBuffer: Buffer,
        filename: string,
        options: TranscribeOptions = {}
    ): Promise<ProviderResult<TranscriptionResult>> {
        if (!this.apiKey) {
            throw new TranscriptionError(
                "No transcription API key configured",
                "Transcription isn't set up on this server (no API key). Ask an admin to add GOOGLE_AI_API_KEY.",
                502
            );
        }

        if (this.native) {
            const { result, tokens } = await this.native.transcribe(audioBuffer, filename, options);
            const durationSeconds = result.durationSeconds ?? 0;
            return {
                data: result,
                usage: {
                    tokensUsed: tokens || transcriptionTokens(durationSeconds),
                    details: {
                        durationSeconds,
                        estimatedMinutes: Math.ceil(durationSeconds / 60),
                    },
                },
            };
        }

        return this.transcribeCompat(audioBuffer, filename);
    }

    private async transcribeCompat(
        audioBuffer: Buffer,
        filename: string
    ): Promise<ProviderResult<TranscriptionResult>> {
        const extension = filename.split(".").pop()?.toLowerCase() ?? "";
        const format = COMPAT_FORMATS[extension];
        if (!format) {
            throw new TranscriptionError(
                `".${extension}" is not an input_audio format on ${this.baseUrl}`,
                `The configured transcription endpoint only accepts MP3 and WAV. Convert this .${extension} ` +
                    "file, or point transcription at Gemini (unset TRANSCRIPTION_API_BASE_URL) or the " +
                    "self-hosted service (TRANSCRIPTION_PROVIDER=sidecar)."
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
            throw new TranscriptionError(
                `Transcription failed (${resp.status}): ${text}`,
                `The transcription service couldn't read this recording (HTTP ${resp.status}).`,
                resp.status >= 500 || resp.status === 429 ? 502 : 422
            );
        }

        const data = (await resp.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
            usage?: { total_tokens?: number };
        };

        const text = data.choices?.[0]?.message?.content?.trim() ?? "";
        const tokens = data.usage?.total_tokens ?? transcriptionTokens(0);

        return {
            data: {
                text,
                // The chat surface reports neither the spoken language nor a
                // confidence score. Saying "unknown" is more useful than a
                // number chosen to look like Whisper's.
                language: "unknown",
                confidence: 0,
                durationSeconds: 0,
            },
            usage: {
                tokensUsed: tokens,
                details: { durationSeconds: 0, estimatedMinutes: 0 },
            },
        };
    }
}
