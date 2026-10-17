/**
 * Transcript translation: the lines of a transcript, in another language, one
 * for one, so a translated line keeps its original's timestamp.
 *
 * Runs on the transcription capability's endpoint and model
 * (TRANSCRIPTION_API_BASE_URL / _KEY / _MODEL, defaulting to Gemini), not the
 * chat route: a deployment whose chat provider is down or out of credit can
 * still read the recordings it was able to transcribe. Text only, so the
 * OpenAI-compatible `/chat/completions` surface serves every vendor.
 */
import { resolveEndpoint, resolveModel } from "@launchstack/llm/providers/registry";
import { GEMINI_DEFAULT_MODEL } from "@launchstack/llm/types";
import { TranscriptionError } from "../errors";
import { GEMINI_ROOT, retryAfterSeconds } from "./gemini-native";

/**
 * Lines per call. Large, because a free-tier Gemini project gets 20 calls a day:
 * an 82-minute meeting (~700 lines) is three calls, each answered in about a minute.
 */
export const TRANSLATION_BATCH_LINES = 250;
const TRANSLATION_CONCURRENCY = 4;
const CALL_TIMEOUT_MS = 3 * 60_000;
const RETRY_DELAYS_MS = [3_000, 10_000, 30_000, 60_000];
/** A transcript longer than this is refused rather than translated for minutes. */
export const MAX_TRANSLATION_LINES = 6_000;

export interface TranslateTranscriptOptions {
    fetchImpl?: typeof fetch;
    /** Waits before retrying a failed batch ("high demand" 503s come in bursts). */
    retryDelaysMs?: number[];
}

export interface TranscriptTranslation {
    /** One per input line, same order. */
    lines: string[];
    model: string;
    tokens: number;
}

/** "zh-Hant" → "Chinese (Traditional)"; unknown codes come back as given. */
export function languageNameOf(code: string): string {
    try {
        return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
    } catch {
        return code;
    }
}

function systemPrompt(target: string): string {
    return (
        `You translate lines of a recorded conversation's transcript into ${languageNameOf(target)} (${target}). ` +
        'Each input line is {"i": number, "t": text}. Return one {"i", "t"} for every input line, with the same ' +
        "i and its translation as t: translate each line on its own, never merging, splitting or dropping " +
        "lines, even one-word replies. Keep names, numbers, product and company terms as they are. A line " +
        "already in the target language is returned unchanged. Translate faithfully, including filler and " +
        "unfinished sentences; do not summarise or add notes."
    );
}

/** Lines a reply may leave out (kept in the original) before the batch is asked again. */
function tolerableMisses(count: number): number {
    return Math.max(2, Math.floor(count * 0.02));
}

async function translateBatch(
    lines: string[],
    target: string,
    endpoint: { baseUrl: string; apiKey: string },
    model: string,
    fetchImpl: typeof fetch
): Promise<{ lines: string[]; tokens: number; missed: number }> {
    const isGemini = endpoint.baseUrl.startsWith(GEMINI_ROOT);
    const resp = await fetchImpl(`${endpoint.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${endpoint.apiKey}`,
        },
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        body: JSON.stringify({
            model,
            // Gemini thinks by default and bills it as output; a translation
            // needs none of it. Other vendors reject the field on models that
            // do not reason, so it is only sent to Google.
            ...(isGemini ? { reasoning_effort: "low" } : {}),
            messages: [
                { role: "system", content: systemPrompt(target) },
                {
                    role: "user",
                    content: JSON.stringify({ lines: lines.map((t, i) => ({ i, t })) }),
                },
            ],
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "translation",
                    strict: true,
                    schema: {
                        type: "object",
                        properties: {
                            lines: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: { i: { type: "integer" }, t: { type: "string" } },
                                    required: ["i", "t"],
                                    additionalProperties: false,
                                },
                            },
                        },
                        required: ["lines"],
                        additionalProperties: false,
                    },
                },
            },
        }),
    });

    if (!resp.ok) {
        const body = await resp.text();
        const wait = retryAfterSeconds(body);
        throw new TranscriptionError(
            `Translation failed (${resp.status}): ${body.slice(0, 500)}`,
            resp.status === 429 && wait !== null && wait > 60 * 60
                ? "This server's translation allowance is used up for today (the Gemini API key is on a " +
                  "limited plan). Try again tomorrow, or ask an admin to enable billing on the Gemini API project."
                : resp.status === 429
                  ? "The translation service is busy (rate limit). Try again in a minute."
                  : resp.status === 503
                    ? "Gemini is overloaded right now. Try again in a few minutes."
                    : "The translation service had a problem. Try again in a few minutes.",
            502
        );
    }

    const data = (await resp.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { total_tokens?: number };
    };
    let out: unknown = null;
    try {
        out = (JSON.parse(data.choices?.[0]?.message?.content ?? "") as { lines?: unknown }).lines;
    } catch {
        out = null;
    }
    // Matched by number, not position: a model that merges two short replies
    // ("系。" "好。") shifts every line after them otherwise.
    const byIndex = new Map<number, string>();
    if (Array.isArray(out)) {
        for (const item of out) {
            if (!item || typeof item !== "object") continue;
            const { i, t } = item as { i?: unknown; t?: unknown };
            if (typeof i === "number" && typeof t === "string" && t.trim()) byIndex.set(i, t);
        }
    }
    const missed = lines.filter((_, i) => !byIndex.has(i)).length;
    if (missed > tolerableMisses(lines.length)) {
        throw new TranscriptionError(
            `Translation returned ${lines.length - missed} of ${lines.length} lines`,
            "The translation came back incomplete. Try again.",
            502
        );
    }
    return {
        lines: lines.map((original, i) => byIndex.get(i) ?? original),
        tokens: data.usage?.total_tokens ?? 0,
        missed,
    };
}

/** Whether a failed batch is worth asking again: not a spent daily quota. */
function worthRetrying(error: unknown): boolean {
    if (!(error instanceof TranscriptionError)) return true;
    const wait = retryAfterSeconds(error.message);
    return wait === null || wait <= 60;
}

/**
 * Translate transcript lines into `target` (a BCP-47 code). A batch that
 * fails — overloaded, rate-limited, or answered with lines missing — is asked
 * again after each of the retry delays before the whole call fails, so a
 * stored translation is complete (a line or two a model skipped stays in the
 * original).
 */
export async function translateTranscriptLines(
    lines: string[],
    target: string,
    options: TranslateTranscriptOptions = {}
): Promise<TranscriptTranslation> {
    if (lines.length > MAX_TRANSLATION_LINES) {
        throw new TranscriptionError(
            `Transcript has ${lines.length} lines, over ${MAX_TRANSLATION_LINES}`,
            "This transcript is too long to translate here."
        );
    }
    const endpoint = resolveEndpoint(
        process.env.TRANSCRIPTION_API_BASE_URL,
        process.env.TRANSCRIPTION_API_KEY
    );
    if (!endpoint.apiKey) {
        throw new TranscriptionError(
            "No transcription/translation API key configured",
            "Translation isn't set up on this server (no API key). Ask an admin to add GOOGLE_AI_API_KEY.",
            502
        );
    }
    const model = resolveModel(process.env.TRANSCRIPTION_MODEL, GEMINI_DEFAULT_MODEL);
    const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));

    const batches: string[][] = [];
    for (let i = 0; i < lines.length; i += TRANSLATION_BATCH_LINES) {
        batches.push(lines.slice(i, i + TRANSLATION_BATCH_LINES));
    }

    const delays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
    const results = new Array<{ lines: string[]; tokens: number; missed: number }>(batches.length);
    let next = 0;
    const worker = async () => {
        while (next < batches.length) {
            const i = next++;
            const batch = batches[i]!;
            for (let attempt = 0; ; attempt++) {
                try {
                    results[i] = await translateBatch(batch, target, endpoint, model, fetchImpl);
                    break;
                } catch (error) {
                    if (attempt >= delays.length || !worthRetrying(error)) throw error;
                    console.warn(
                        `[TranscriptTranslation] batch ${i + 1}/${batches.length} failed (${
                            error instanceof Error ? error.message.slice(0, 120) : String(error)
                        }), retry ${attempt + 1}`
                    );
                    await new Promise(r => setTimeout(r, delays[attempt]));
                }
            }
        }
    };
    await Promise.all(
        Array.from({ length: Math.min(TRANSLATION_CONCURRENCY, batches.length) }, worker)
    );

    const missed = results.reduce((n, r) => n + r.missed, 0);
    if (missed > 0) {
        console.warn(`[TranscriptTranslation] ${missed} line(s) left in the original language`);
    }
    return {
        lines: results.flatMap(r => r.lines),
        model,
        tokens: results.reduce((n, r) => n + r.tokens, 0),
    };
}
