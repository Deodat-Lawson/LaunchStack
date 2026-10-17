/**
 * Transcription on Gemini's native API (`generateContent`), the path taken
 * whenever the transcription endpoint is Google's own.
 *
 * Why not the OpenAI-compatible surface the rest of the deployment uses: its
 * `input_audio` part accepts only wav and mp3 ("Invalid audio format "aac" …
 * Valid formats are: [wav, mp3]" was every .m4a upload in production), and it
 * has no file upload, so a recording over the inline cap cannot be sent at all.
 * The native API takes the real container types and stores large media through
 * the Files API (2 GB, kept 48 h).
 *
 * A recording is transcribed in windows of {@link WINDOW_SECONDS}. One call
 * over a long meeting runs out of output tokens long before Gemini runs out of
 * input (dense Cantonese came to ~620 tokens a minute against a 65,536 cap), and
 * a cut-off JSON reply is lost whole.
 *
 * Where ffmpeg is installed (the app image has it) each window is its own small
 * chunk of the recording, sent inline ({@link splitAudio}). Without it, each
 * window is a prompt over a time range of the whole file, stored once through
 * the Files API; Gemini ignores clip offsets on audio, so every such call is
 * billed — and rate-limited — for the whole file's audio.
 */
import type { TranscriptionResult } from "./index";
import { TranscriptionError } from "../errors";
import { splitAudio } from "./ffmpeg-chunks";

export const GEMINI_ROOT = "https://generativelanguage.googleapis.com";

/**
 * Seconds of speech per transcription call: ~19k output tokens of dense speech,
 * well under the cap, and an 82-minute meeting in three calls.
 */
export const WINDOW_SECONDS = 30 * 60;
/** Windows below this are not split further when a reply is cut off. */
const MIN_WINDOW_SECONDS = 2 * 60;
const WINDOW_CONCURRENCY = 4;
/**
 * Raw bytes sent inline rather than through the Files API. The request cap is
 * 100 MB of base64; staying far below it keeps small clips (dictation, voice
 * notes) to one round trip.
 */
export const INLINE_MAX_BYTES = 16 * 1024 * 1024;
/** Gemini's fixed audio tokenisation rate. */
const AUDIO_TOKENS_PER_SECOND = 32;
/** Gemini's per-prompt audio ceiling. */
export const MAX_AUDIO_SECONDS = 9.5 * 60 * 60;
const CALL_TIMEOUT_MS = 10 * 60_000;
/** Waits before retrying a 5xx or a short 429; Gemini answers "high demand" 503s in bursts. */
const RETRY_DELAYS_MS = [3_000, 10_000, 30_000, 60_000];
/** A 429 asking for a longer wait than this is a spent quota, not a burst: fail now. */
const MAX_RETRY_WAIT_SECONDS = 60;
/**
 * A verbatim transcript of a business recording is not the place for harm
 * filters: a blocked reply loses the speech without saying what was said.
 */
const SAFETY_OFF = [
    "HARM_CATEGORY_HARASSMENT",
    "HARM_CATEGORY_HATE_SPEECH",
    "HARM_CATEGORY_SEXUALLY_EXPLICIT",
    "HARM_CATEGORY_DANGEROUS_CONTENT",
    "HARM_CATEGORY_CIVIC_INTEGRITY",
].map(category => ({ category, threshold: "BLOCK_NONE" }));
/** A reply ending this long before its window does is asked to carry on. */
const CONTINUE_AFTER_SECONDS = 90;
const MAX_CONTINUATIONS = 3;
/** More of the recording than this lost to unusable replies fails the upload instead. */
const MAX_GAP_FRACTION = 0.5;
const FILE_READY_TIMEOUT_MS = 5 * 60_000;
const FILE_POLL_MS = 2_000;

/**
 * Container/codec → the MIME type Gemini documents. MPEG-4 is declared as
 * audio: a video .mp4 then costs 32 tokens a second instead of ~100, and only
 * its soundtrack is transcribed.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
    mp3: "audio/mp3",
    mpeg: "audio/mpeg",
    wav: "audio/wav",
    aiff: "audio/aiff",
    aif: "audio/aiff",
    aac: "audio/aac",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    opus: "audio/opus",
    flac: "audio/flac",
    webm: "audio/webm",
    m4a: "audio/m4a",
    mp4: "audio/mp4",
};

const MIME_ALIASES: Record<string, string> = {
    "audio/mpeg": "audio/mp3",
    "audio/x-m4a": "audio/m4a",
    "audio/x-wav": "audio/wav",
    "audio/wave": "audio/wav",
    "audio/x-flac": "audio/flac",
    "audio/x-aiff": "audio/aiff",
    "video/mp4": "audio/mp4",
    "video/webm": "audio/webm",
};

/** The MIME type to declare to Gemini, or null when it has none for this file. */
export function nativeAudioMimeType(filename: string, mimeType?: string): string | null {
    const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
    const byExtension = MIME_BY_EXTENSION[ext];
    if (byExtension) return byExtension;
    const type = mimeType?.toLowerCase().split(";")[0]?.trim();
    if (!type) return null;
    if (MIME_ALIASES[type]) return MIME_ALIASES[type];
    return Object.values(MIME_BY_EXTENSION).includes(type) ? type : null;
}

/** The native API root when `baseUrl` is Google's endpoint, else null. */
export function geminiNativeRoot(baseUrl: string): string | null {
    return baseUrl.startsWith(GEMINI_ROOT) ? GEMINI_ROOT : null;
}

export interface NativeTranscribeConfig {
    root: string;
    apiKey: string;
    model: string;
    fetchImpl?: typeof fetch;
    /** Test seam: how long to wait between Files API state polls. */
    pollMs?: number;
    /** Test seam: the chunker, or null for a host without ffmpeg. */
    splitAudio?: typeof splitAudio | null;
    /** Test seam: waits between retries. */
    retryDelaysMs?: number[];
}

type MediaPart =
    | { inlineData: { mimeType: string; data: string } }
    | { fileData: { mimeType: string; fileUri: string } };

interface Window {
    start: number;
    end: number;
}

interface WindowTranscript {
    language: string;
    languages: string[];
    segments: { start: number; end: number; text: string }[];
    tokens: number;
    /** Seconds of this window Gemini returned nothing usable for. */
    gapSeconds?: number;
}

/** The line a transcript shows where Gemini returned nothing usable. */
export function gapLine(label: string): string {
    return `[${label} could not be transcribed]`;
}

const TRANSCRIPT_SCHEMA = {
    type: "OBJECT",
    properties: {
        language: { type: "STRING" },
        languages: { type: "ARRAY", items: { type: "STRING" } },
        segments: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    start: { type: "NUMBER" },
                    end: { type: "NUMBER" },
                    text: { type: "STRING" },
                },
                required: ["start", "end", "text"],
            },
        },
    },
    required: ["language", "segments"],
};

function clock(seconds: number): string {
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const pad = (n: number) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** The instruction for one window. Exported for tests. */
export function windowPrompt(window: Window, duration: number): string {
    const whole = window.start <= 0 && window.end >= duration;
    const range = whole
        ? "Transcribe all of the speech in this recording"
        : `Transcribe only the speech in this recording from ${clock(window.start)} to ${clock(window.end)}`;
    return (
        `${range}, verbatim, in the language or languages actually spoken. ` +
        "Never translate: keep every word in the language it was said in, including " +
        "mixed-language speech such as English terms inside Chinese. " +
        "Split it into segments at natural pauses, one or two sentences each. " +
        "Give each segment's start and end as a number of seconds from the beginning of the whole " +
        "recording (75.5 means 1:15.5), in the order the segments were spoken" +
        (whole
            ? ". "
            : `, so the first segment starts at about ${Math.round(window.start)} and the last ends by ${Math.round(window.end)}. `) +
        "Set `language` to the main spoken language as the most specific BCP-47 code you can " +
        "tell (for example en, es, fr, ja, ar, yue for Cantonese, zh for Mandarin) and list every " +
        "language heard in `languages`. If there is no intelligible speech, return no segments."
    );
}

/** Contiguous windows covering [0, duration). Exported for tests. */
export function planWindows(duration: number, size = WINDOW_SECONDS): Window[] {
    if (duration <= size) return [{ start: 0, end: Math.max(duration, 0) }];
    const windows: Window[] = [];
    for (let start = 0; start < duration; start += size) {
        windows.push({ start, end: Math.min(start + size, duration) });
    }
    // A sliver at the end is folded into the window before it.
    const last = windows[windows.length - 1]!;
    if (windows.length > 1 && last.end - last.start < 60) {
        windows.pop();
        windows[windows.length - 1]!.end = duration;
    }
    return windows;
}

/**
 * Stitch window transcripts into one: segments in time order, each clamped to
 * the recording, with a line repeated across a window boundary kept once.
 * Exported for tests.
 */
export function mergeWindows(
    parts: WindowTranscript[],
    duration: number
): Pick<TranscriptionResult, "language" | "languages" | "segments" | "text"> {
    // Parts arrive in time order and a model writes lines in the order they
    // were spoken, so that order is kept. Timestamps are the model's guess and
    // can be wrong (flash-lite once timed an 8-second clip in fractions of a
    // second, out of order); sorting by them would scramble the sentences, so
    // a time that runs backwards is pulled forward instead.
    const segments: { start: number; end: number; text: string }[] = [];
    let floor = 0;
    for (const s of parts.flatMap(p => p.segments)) {
        const text = s.text.trim();
        if (!text) continue;
        const start = Math.min(Math.max(floor, s.start), duration);
        const end = Math.min(Math.max(start, s.end), duration);
        segments.push({ start, end, text });
        floor = start;
    }

    const deduped: typeof segments = [];
    for (const segment of segments) {
        const prev = deduped[deduped.length - 1];
        if (prev && prev.text === segment.text && segment.start - prev.start < 5) continue;
        deduped.push(segment);
    }

    // The main language is the one most of the words were in.
    const weight = new Map<string, number>();
    const heard: string[] = [];
    for (const part of parts) {
        const chars = part.segments.reduce((n, s) => n + s.text.length, 0);
        const main = normaliseLanguage(part.language);
        if (main && chars > 0) weight.set(main, (weight.get(main) ?? 0) + chars);
        for (const code of [part.language, ...part.languages]) {
            const lang = normaliseLanguage(code);
            if (lang && !heard.includes(lang)) heard.push(lang);
        }
    }
    const language = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
    const languages =
        language === "unknown" ? heard : [language, ...heard.filter(l => l !== language)];

    return {
        text: deduped.map(s => s.text).join("\n"),
        language,
        ...(languages.length > 0 ? { languages } : {}),
        segments: deduped,
    };
}

/** "ZH-hant" → "zh-Hant"; "", "und", "unknown" → null. */
export function normaliseLanguage(code: string | undefined): string | null {
    const raw = code?.trim().replace(/_/g, "-");
    if (!raw || /^(und|unknown|none|n\/a)$/i.test(raw)) return null;
    try {
        return Intl.getCanonicalLocales(raw)[0] ?? null;
    } catch {
        return null;
    }
}

async function mapLimit<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i]!);
        }
    });
    await Promise.all(workers);
    return results;
}

interface GeminiErrorBody {
    error?: { message?: string; status?: string };
}

/**
 * How long a 429 asks the caller to wait, in seconds, from Google's "Please
 * retry in 7h46m39.3s" / "retry in 28s"; null when it does not say.
 */
export function retryAfterSeconds(message: string): number | null {
    const match = /retry in ((?:\d+h)?(?:\d+m)?(?:[\d.]+s)?)/i.exec(message);
    if (!match?.[1]) return null;
    const [, h, m, sec] = /^(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?$/.exec(match[1]) ?? [];
    const total = Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(sec ?? 0);
    return total > 0 ? total : null;
}

/** Turn a non-OK Gemini response into an error the uploader can read. */
async function vendorError(resp: Response, what: string): Promise<TranscriptionError> {
    const body = await resp.text();
    let detail = body.slice(0, 500);
    try {
        detail = (JSON.parse(body) as GeminiErrorBody).error?.message ?? detail;
    } catch {
        // not JSON: keep the raw text
    }
    const wait = retryAfterSeconds(detail);
    const userMessage =
        resp.status === 429 && wait !== null && wait > 60 * 60
            ? "This server's transcription allowance is used up for today (the Gemini API key is on a " +
              "limited plan). Try again tomorrow, or ask an admin to enable billing on the Gemini API project."
            : resp.status === 429
              ? "The transcription service is busy (rate limit). Try again in a minute."
              : resp.status === 503 && /high demand|overloaded/i.test(detail)
                ? "Gemini is overloaded right now and didn't recover within two minutes. Try again in a few minutes."
                : resp.status === 401 || resp.status === 403
                  ? "The transcription service rejected this workspace's API key. Ask an admin to check the transcription key."
                  : resp.status >= 500
                    ? "The transcription service had a problem. Try again in a few minutes."
                    : `The transcription service couldn't read this recording: ${detail}`;
    return new TranscriptionError(
        `${what} failed (${resp.status}): ${detail}`,
        userMessage,
        resp.status >= 500 || resp.status === 429 ? 502 : 422
    );
}

export class GeminiNativeTranscriber {
    private readonly fetchImpl: typeof fetch;

    constructor(private readonly config: NativeTranscribeConfig) {
        this.fetchImpl = config.fetchImpl ?? ((input, init) => fetch(input, init));
    }

    private get api(): string {
        return `${this.config.root}/v1beta`;
    }

    private headers(json = true): Record<string, string> {
        return {
            "x-goog-api-key": this.config.apiKey,
            ...(json ? { "Content-Type": "application/json" } : {}),
        };
    }

    /**
     * POST JSON to Gemini, retrying the failures that pass on their own: 5xx
     * ("high demand") and a 429 that asks for a short wait.
     */
    private async post(url: string, body: unknown, what: string): Promise<Response> {
        const delays = this.config.retryDelaysMs ?? RETRY_DELAYS_MS;
        for (let attempt = 0; ; attempt++) {
            const resp = await this.fetchImpl(url, {
                method: "POST",
                headers: this.headers(),
                signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
                body: JSON.stringify(body),
            });
            if (resp.ok) return resp;
            let retryable = resp.status >= 500;
            if (resp.status === 429) {
                const wait = retryAfterSeconds(await resp.clone().text());
                retryable = wait === null || wait <= MAX_RETRY_WAIT_SECONDS;
            }
            if (!retryable || attempt >= delays.length) throw await vendorError(resp, what);
            console.warn(`[Transcription] ${what}: HTTP ${resp.status}, retry ${attempt + 1}`);
            await new Promise(r => setTimeout(r, delays[attempt]));
        }
    }

    /** Thinking spends the same output budget the transcript needs; keep it low where the model allows. */
    private thinking(): Record<string, unknown> {
        return this.config.model.startsWith("gemini-3")
            ? { thinkingConfig: { thinkingLevel: "low" } }
            : {};
    }

    async transcribe(
        audio: Buffer,
        filename: string,
        options: { mimeType?: string; timestamps?: boolean } = {}
    ): Promise<{ result: TranscriptionResult; tokens: number }> {
        const mimeType = nativeAudioMimeType(filename, options.mimeType);
        if (!mimeType) {
            const ext = filename.includes(".") ? `.${filename.split(".").pop()}` : "this file";
            throw new TranscriptionError(
                `Gemini has no audio format for ${filename} (${options.mimeType ?? "no type"})`,
                `${ext} recordings can't be transcribed. Use MP3, M4A, MP4, WAV, AAC, FLAC or OGG.`
            );
        }

        if (options.timestamps === false && audio.length <= INLINE_MAX_BYTES) {
            return this.plainText(audio, mimeType);
        }

        const split = this.config.splitAudio === undefined ? splitAudio : this.config.splitAudio;
        let chunked: Awaited<ReturnType<typeof splitAudio>> = null;
        if (split) {
            try {
                chunked = await split(audio, filename, WINDOW_SECONDS);
            } catch (error) {
                throw new TranscriptionError(
                    `ffmpeg could not decode ${filename}: ${error instanceof Error ? error.message : String(error)}`,
                    "This recording couldn't be decoded. Check that it plays, or export it again as MP3 or M4A."
                );
            }
        }
        if (chunked) return this.transcribeChunks(chunked, filename);

        let uploaded: { name: string } | null = null;
        let media: MediaPart;
        if (audio.length <= INLINE_MAX_BYTES) {
            media = { inlineData: { mimeType, data: audio.toString("base64") } };
        } else {
            const file = await this.upload(audio, mimeType, filename);
            uploaded = file;
            media = { fileData: { mimeType: file.mimeType, fileUri: file.uri } };
        }

        try {
            const duration = await this.durationOf(media);
            if (duration > MAX_AUDIO_SECONDS) {
                throw new TranscriptionError(
                    `${filename} is ${Math.round(duration / 60)} min, over Gemini's 9.5 h limit`,
                    `This recording is ${(duration / 3600).toFixed(1)} hours long; the limit is 9.5 hours. Split it and upload the parts.`
                );
            }
            const parts = await mapLimit(planWindows(duration), WINDOW_CONCURRENCY, w =>
                this.transcribeWindow(media, w, duration)
            );
            return this.finish(parts.flat(), duration, filename);
        } finally {
            if (uploaded) await this.deleteFile(uploaded.name);
        }
    }

    /** One call per ffmpeg chunk, each timed from its own start, then shifted into place. */
    private async transcribeChunks(
        { duration, chunks }: NonNullable<Awaited<ReturnType<typeof splitAudio>>>,
        filename: string
    ): Promise<{ result: TranscriptionResult; tokens: number }> {
        console.log(
            `[Transcription] ${filename}: ${Math.round(duration)}s in ${chunks.length} chunk(s) of ≤${WINDOW_SECONDS / 60} min`
        );
        const parts = await mapLimit(chunks, WINDOW_CONCURRENCY, async chunk => {
            const span = chunk.end - chunk.start;
            const media: MediaPart = {
                inlineData: { mimeType: "audio/mp3", data: chunk.bytes.toString("base64") },
            };
            const windows = await this.transcribeWindow(
                media,
                { start: 0, end: span },
                span,
                chunk.start
            );
            return windows.map(w => ({
                ...w,
                segments: w.segments.map(s => ({
                    start: s.start + chunk.start,
                    end: s.end + chunk.start,
                    text: s.text,
                })),
            }));
        });
        return this.finish(parts.flat(), duration, filename);
    }

    /** Merge the windows, unless too much of the recording came back unusable. */
    private finish(
        parts: WindowTranscript[],
        duration: number,
        filename: string
    ): { result: TranscriptionResult; tokens: number } {
        const gap = parts.reduce((n, p) => n + (p.gapSeconds ?? 0), 0);
        if (duration > 0 && gap / duration > MAX_GAP_FRACTION) {
            throw new TranscriptionError(
                `${filename}: ${Math.round(gap)}s of ${Math.round(duration)}s came back unusable`,
                "The transcription service returned nothing usable for most of this recording. Try again later.",
                502
            );
        }
        if (gap > 0) {
            console.warn(`[Transcription] ${filename}: ${Math.round(gap)}s left as gaps`);
        }
        const merged = mergeWindows(parts, duration);
        return {
            result: { ...merged, confidence: 0, durationSeconds: duration },
            tokens: parts.reduce((n, p) => n + p.tokens, 0),
        };
    }

    /** Dictation: the words only, no timestamps, one call. */
    private async plainText(
        audio: Buffer,
        mimeType: string
    ): Promise<{ result: TranscriptionResult; tokens: number }> {
        const resp = await this.post(
            `${this.api}/models/${this.config.model}:generateContent`,
            {
                contents: [
                    {
                        parts: [
                            { inlineData: { mimeType, data: audio.toString("base64") } },
                            {
                                text:
                                    "Transcribe this audio verbatim in the language spoken. Reply with the " +
                                    "transcript text only — no preamble, no commentary, no quotation marks. " +
                                    "If there is no intelligible speech, reply with nothing at all.",
                            },
                        ],
                    },
                ],
                safetySettings: SAFETY_OFF,
                generationConfig: { ...this.thinking() },
            },
            "Gemini transcription"
        );
        const data = (await resp.json()) as GenerateResponse;
        const text = (data.candidates?.[0]?.content?.parts ?? [])
            .map(p => p.text ?? "")
            .join("")
            .trim();
        return {
            result: { text, language: "unknown", confidence: 0 },
            tokens: data.usageMetadata?.totalTokenCount ?? 0,
        };
    }

    /** Recording length, from Gemini's own count of its audio tokens (32 per second). */
    private async durationOf(media: MediaPart): Promise<number> {
        const resp = await this.post(
            `${this.api}/models/${this.config.model}:countTokens`,
            { contents: [{ parts: [media] }] },
            "Gemini countTokens"
        );
        const data = (await resp.json()) as {
            totalTokens?: number;
            promptTokensDetails?: { modality?: string; tokenCount?: number }[];
        };
        const audioTokens =
            data.promptTokensDetails?.find(d => d.modality === "AUDIO")?.tokenCount ??
            data.totalTokens ??
            0;
        return audioTokens / AUDIO_TOKENS_PER_SECOND;
    }

    /**
     * One window. A reply cut off by the output cap is retried as two halves,
     * down to {@link MIN_WINDOW_SECONDS}.
     */
    private async transcribeWindow(
        media: MediaPart,
        window: Window,
        duration: number,
        /** Where this media starts in the whole recording, for log lines only. */
        offset = 0,
        /** How many times this window has already been asked to carry on. */
        continuation = 0
    ): Promise<WindowTranscript[]> {
        const label = `${clock(offset + window.start)}–${clock(offset + window.end)}`;
        const started = Date.now();
        const resp = await this.post(
            `${this.api}/models/${this.config.model}:generateContent`,
            {
                contents: [{ parts: [media, { text: windowPrompt(window, duration) }] }],
                safetySettings: SAFETY_OFF,
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: TRANSCRIPT_SCHEMA,
                    maxOutputTokens: 65_536,
                    ...this.thinking(),
                },
            },
            `Gemini transcription ${label}`
        );
        const data = (await resp.json()) as GenerateResponse;
        const candidate = data.candidates?.[0];
        const raw = (candidate?.content?.parts ?? []).map(p => p.text ?? "").join("");
        const tokens = data.usageMetadata?.totalTokenCount ?? 0;

        let parsed: Partial<WindowTranscript> | null = null;
        if (candidate?.finishReason !== "MAX_TOKENS") {
            try {
                parsed = JSON.parse(raw) as Partial<WindowTranscript>;
            } catch {
                parsed = null;
            }
        }

        if (!parsed) {
            const span = window.end - window.start;
            console.warn(
                `[Transcription] ${label} reply unusable ` +
                    `(finishReason ${candidate?.finishReason ?? "none"}, ` +
                    `blockReason ${data.promptFeedback?.blockReason ?? "none"}, ${raw.length} chars, ` +
                    `${tokens} tokens); ${span / 2 < MIN_WINDOW_SECONDS ? "keeping a gap" : "splitting"}`
            );
            if (span / 2 < MIN_WINDOW_SECONDS) {
                // A few minutes Gemini will not transcribe should not cost the
                // whole meeting: mark them, and let the caller decide whether
                // too much was lost (MAX_GAP_FRACTION).
                return [
                    {
                        language: "unknown",
                        languages: [],
                        segments: [{ start: window.start, end: window.end, text: gapLine(label) }],
                        tokens,
                        gapSeconds: span,
                    },
                ];
            }
            const mid = window.start + span / 2;
            const halves = await Promise.all([
                this.transcribeWindow(media, { start: window.start, end: mid }, duration, offset),
                this.transcribeWindow(media, { start: mid, end: window.end }, duration, offset),
            ]);
            return halves.flat();
        }

        // Keep the lines that begin inside this window; a neighbour owns the rest.
        const segments = (parsed.segments ?? []).filter(
            s =>
                typeof s.start === "number" &&
                typeof s.text === "string" &&
                s.start >= window.start - 2 &&
                (s.start < window.end || window.end >= duration)
        );
        console.log(
            `[Transcription] ${label}: ${segments.length} lines, ` +
                `lang=${parsed.language ?? "?"}, ${tokens} tokens, ${Date.now() - started}ms`
        );
        const part: WindowTranscript = {
            language: parsed.language ?? "unknown",
            languages: Array.isArray(parsed.languages) ? parsed.languages : [],
            segments: segments.map(s => ({
                start: s.start,
                end: typeof s.end === "number" ? s.end : s.start,
                text: s.text,
            })),
            tokens,
        };

        // A reply can stop well short of its window with finishReason STOP
        // (flash-lite left the last 11 minutes of a 30-minute chunk out).
        // Ask for the rest; an empty answer means the remainder is silence.
        const lastEnd = part.segments.reduce((m, seg) => Math.max(m, seg.end), window.start);
        if (
            part.segments.length > 0 &&
            window.end - lastEnd > CONTINUE_AFTER_SECONDS &&
            continuation < MAX_CONTINUATIONS
        ) {
            console.warn(
                `[Transcription] ${label}: reply stopped at ${clock(offset + lastEnd)}; asking for the rest`
            );
            const rest = await this.transcribeWindow(
                media,
                { start: Math.floor(lastEnd), end: window.end },
                duration,
                offset,
                continuation + 1
            );
            return [part, ...rest];
        }
        return [part];
    }

    /** Resumable Files API upload, then wait until Gemini has processed it. */
    private async upload(
        audio: Buffer,
        mimeType: string,
        filename: string
    ): Promise<{ name: string; uri: string; mimeType: string }> {
        const start = await this.fetchImpl(`${this.config.root}/upload/v1beta/files`, {
            method: "POST",
            headers: {
                ...this.headers(),
                "X-Goog-Upload-Protocol": "resumable",
                "X-Goog-Upload-Command": "start",
                "X-Goog-Upload-Header-Content-Length": String(audio.length),
                "X-Goog-Upload-Header-Content-Type": mimeType,
            },
            signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
            body: JSON.stringify({ file: { display_name: filename.slice(0, 120) } }),
        });
        if (!start.ok) throw await vendorError(start, "Gemini file upload (start)");
        const uploadUrl = start.headers.get("x-goog-upload-url");
        if (!uploadUrl) {
            throw new TranscriptionError(
                "Gemini file upload returned no upload URL",
                "The transcription service had a problem. Try again in a few minutes.",
                502
            );
        }

        const put = await this.fetchImpl(uploadUrl, {
            method: "POST",
            headers: {
                "X-Goog-Upload-Offset": "0",
                "X-Goog-Upload-Command": "upload, finalize",
            },
            signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
            body: new Uint8Array(audio),
        });
        if (!put.ok) throw await vendorError(put, "Gemini file upload");
        let file = ((await put.json()) as { file?: GeminiFile }).file;

        const deadline = Date.now() + FILE_READY_TIMEOUT_MS;
        while (file?.state === "PROCESSING" && Date.now() < deadline) {
            await new Promise(r => setTimeout(r, this.config.pollMs ?? FILE_POLL_MS));
            const poll = await this.fetchImpl(`${this.api}/${file.name}`, {
                headers: this.headers(false),
                signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
            });
            if (!poll.ok) throw await vendorError(poll, "Gemini file status");
            file = (await poll.json()) as GeminiFile;
        }
        if (!file?.uri || file.state !== "ACTIVE") {
            if (file?.name) await this.deleteFile(file.name);
            throw new TranscriptionError(
                `Gemini file ${file?.name ?? "?"} ended in state ${file?.state ?? "unknown"}`,
                file?.state === "FAILED"
                    ? "The transcription service couldn't decode this recording. Check that it plays, or convert it to MP3."
                    : "The transcription service took too long to accept this recording. Try again.",
                file?.state === "FAILED" ? 422 : 502
            );
        }
        return { name: file.name, uri: file.uri, mimeType: file.mimeType ?? mimeType };
    }

    /** Best effort: Gemini deletes it after 48 h anyway. */
    private async deleteFile(name: string): Promise<void> {
        try {
            await this.fetchImpl(`${this.api}/${name}`, {
                method: "DELETE",
                headers: this.headers(false),
                signal: AbortSignal.timeout(30_000),
            });
        } catch (error) {
            console.warn(`[Transcription] Could not delete Gemini file ${name}:`, error);
        }
    }
}

interface GeminiFile {
    name: string;
    uri?: string;
    mimeType?: string;
    state?: "PROCESSING" | "ACTIVE" | "FAILED" | "STATE_UNSPECIFIED";
}

interface GenerateResponse {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
    usageMetadata?: { totalTokenCount?: number };
}
