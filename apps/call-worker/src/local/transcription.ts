export interface TranscriptionInput {
    audioWav: Uint8Array;
    language?: string;
    /** Per-request cancellation signal. */
    signal?: AbortSignal;
    /** Per-request timeout override. */
    timeoutMs?: number;
}

export interface TranscriptionRequestOptions {
    signal?: AbortSignal;
    timeoutMs?: number;
}

export interface TranscriptionModel {
    transcribe(input: TranscriptionInput, options?: TranscriptionRequestOptions): Promise<string>;
}

export interface OpenAiCompatibleTranscriptionModelOptions {
    /** Base URL such as `https://api.openai.com/v1`. */
    baseUrl?: string;
    /** Alias for baseUrl. */
    baseURL?: string;
    /** A complete endpoint is also accepted and may already end in `/audio/transcriptions`. */
    endpoint?: string;
    model?: string;
    /** Alias for model. */
    modelId?: string;
    apiKey?: string;
    timeoutMs?: number;
    /** Native fetch by default; injectable for process-level adapters and tests. */
    fetch?: typeof globalThis.fetch;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:8000/v1";
const DEFAULT_MODEL = "whisper-1";
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_ERROR_BODY_LENGTH = 4_096;

function asError(value: unknown): Error {
    return value instanceof Error ? value : new Error(String(value));
}

function requiredText(value: string | undefined, name: string): string {
    const result = value?.trim();
    if (!result) throw new Error(`${name} is required`);
    return result;
}

function checkedTimeout(value: number, name = "timeoutMs"): number {
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive finite number`);
    }
    return value;
}

function endpointFor(baseUrl: string): string {
    const normalized = baseUrl.replace(/\/+$/, "");
    if (!normalized) throw new Error("baseUrl is required");
    return /\/audio\/transcriptions(?:[/?]|$)/.test(normalized)
        ? normalized
        : `${normalized}/audio/transcriptions`;
}

function abortReason(signal: AbortSignal): Error {
    const reason: unknown = signal.reason;
    return reason instanceof Error
        ? reason
        : new Error(typeof reason === "string" ? reason : "transcription request aborted", {
              cause: reason,
          });
}

function responseText(response: Response): Promise<string> {
    return response
        .text()
        .then(text => text.slice(0, MAX_ERROR_BODY_LENGTH))
        .catch(() => "");
}

/** OpenAI `/audio/transcriptions` client using only Node 24's fetch/FormData. */
export class OpenAiCompatibleTranscriptionModel implements TranscriptionModel {
    readonly endpoint: string;
    readonly model: string;
    readonly apiKey?: string;
    readonly timeoutMs: number;

    private readonly fetchImpl: typeof globalThis.fetch;

    constructor(options?: OpenAiCompatibleTranscriptionModelOptions);
    constructor(baseUrl: string, model?: string, apiKey?: string);
    constructor(
        optionsOrBaseUrl: OpenAiCompatibleTranscriptionModelOptions | string = {},
        positionalModel?: string,
        positionalApiKey?: string
    ) {
        const options: OpenAiCompatibleTranscriptionModelOptions =
            typeof optionsOrBaseUrl === "string"
                ? {
                      baseUrl: optionsOrBaseUrl,
                      model: positionalModel,
                      apiKey: positionalApiKey,
                  }
                : optionsOrBaseUrl;
        const configuredBaseUrl =
            options.baseUrl ??
            options.baseURL ??
            options.endpoint ??
            process.env.CALL_NOTES_TRANSCRIPTION_BASE_URL ??
            process.env.AI_BASE_URL ??
            DEFAULT_BASE_URL;
        const configuredModel =
            options.model ??
            options.modelId ??
            process.env.CALL_NOTES_TRANSCRIPTION_MODEL ??
            process.env.AI_TRANSCRIPTION_MODEL ??
            DEFAULT_MODEL;
        const configuredApiKey =
            options.apiKey ??
            process.env.CALL_NOTES_TRANSCRIPTION_API_KEY ??
            process.env.AI_API_KEY;

        this.endpoint = endpointFor(requiredText(configuredBaseUrl, "baseUrl"));
        this.model = requiredText(configuredModel, "model");
        const apiKey = configuredApiKey?.trim();
        this.apiKey = apiKey === "" ? undefined : apiKey;
        this.timeoutMs = checkedTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        this.fetchImpl = options.fetch ?? globalThis.fetch;
        if (typeof this.fetchImpl !== "function") {
            throw new Error("global fetch is unavailable");
        }
    }

    async transcribe(
        input: TranscriptionInput,
        requestOptions: TranscriptionRequestOptions = {}
    ): Promise<string> {
        if (!input || typeof input !== "object") {
            throw new TypeError("transcription input is required");
        }
        if (!(input.audioWav instanceof Uint8Array)) {
            throw new TypeError("audioWav must be a Uint8Array");
        }
        if (input.audioWav.byteLength === 0) {
            throw new Error("audioWav must not be empty");
        }

        const externalSignal = requestOptions.signal ?? input.signal;
        if (externalSignal?.aborted) throw abortReason(externalSignal);
        const timeoutMs = checkedTimeout(
            requestOptions.timeoutMs ?? input.timeoutMs ?? this.timeoutMs
        );
        const controller = new AbortController();
        let timedOut = false;
        const abortFromCaller = (): void => {
            controller.abort(externalSignal?.reason);
        };

        if (externalSignal) {
            externalSignal.addEventListener("abort", abortFromCaller, { once: true });
        }
        const timeout = setTimeout(() => {
            timedOut = true;
            controller.abort(new Error(`transcription request timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        timeout.unref?.();

        const form = new FormData();
        form.append(
            "file",
            new Blob([new Uint8Array(input.audioWav)], { type: "audio/wav" }),
            "audio.wav"
        );
        form.append("model", this.model);
        if (typeof input.language === "string" && input.language.trim()) {
            form.append("language", input.language.trim());
        }

        const headers: Record<string, string> = {};
        if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

        try {
            const response = await this.fetchImpl(this.endpoint, {
                method: "POST",
                headers,
                body: form,
                signal: controller.signal,
            });
            if (!response.ok) {
                const detail = await responseText(response);
                throw new Error(
                    `transcription request failed (${response.status})${detail ? `: ${detail}` : ""}`
                );
            }

            let payload: unknown;
            try {
                payload = await response.json();
            } catch (error) {
                throw new Error(
                    `transcription response was not valid JSON: ${asError(error).message}`,
                    { cause: error }
                );
            }
            if (
                payload === null ||
                typeof payload !== "object" ||
                !("text" in payload) ||
                typeof payload.text !== "string"
            ) {
                throw new Error("transcription response must contain a text string");
            }
            const text = payload.text;
            if (!text.trim()) {
                throw new Error("transcription response text must not be empty");
            }
            return text;
        } catch (error) {
            if (timedOut) {
                throw new Error(`transcription request timed out after ${timeoutMs}ms`, {
                    cause: error,
                });
            }
            if (externalSignal?.aborted) throw abortReason(externalSignal);
            throw error;
        } finally {
            if (timeout !== undefined) clearTimeout(timeout);
            if (externalSignal) {
                externalSignal.removeEventListener("abort", abortFromCaller);
            }
        }
    }
}

export interface AzureSpeechFastTranscriptionModelOptions {
    endpoint: string;
    apiKey: string;
    apiVersion?: string;
    timeoutMs?: number;
    fetch?: typeof globalThis.fetch;
}

const DEFAULT_AZURE_SPEECH_API_VERSION = "2025-10-15";

function azureSpeechEndpoint(endpoint: string, apiVersion: string): string {
    const url = new URL(requiredText(endpoint, "endpoint"));
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("endpoint must use HTTP(S)");
    }
    if (url.pathname === "/" || url.pathname === "") {
        url.pathname = "/speechtotext/transcriptions:transcribe";
    } else if (!url.pathname.endsWith("/speechtotext/transcriptions:transcribe")) {
        url.pathname = `${url.pathname.replace(/\/+$/, "")}/speechtotext/transcriptions:transcribe`;
    }
    if (!url.searchParams.has("api-version")) {
        url.searchParams.set("api-version", requiredText(apiVersion, "apiVersion"));
    }
    return url.toString();
}

/** Azure Speech synchronous Fast Transcription client for short WAV utterances. */
export class AzureSpeechFastTranscriptionModel implements TranscriptionModel {
    readonly endpoint: string;
    readonly apiKey: string;
    readonly timeoutMs: number;

    private readonly fetchImpl: typeof globalThis.fetch;

    constructor(options: AzureSpeechFastTranscriptionModelOptions) {
        this.endpoint = azureSpeechEndpoint(
            options.endpoint,
            options.apiVersion ?? DEFAULT_AZURE_SPEECH_API_VERSION
        );
        this.apiKey = requiredText(options.apiKey, "apiKey");
        this.timeoutMs = checkedTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        this.fetchImpl = options.fetch ?? globalThis.fetch;
        if (typeof this.fetchImpl !== "function") {
            throw new Error("global fetch is unavailable");
        }
    }

    async transcribe(
        input: TranscriptionInput,
        requestOptions: TranscriptionRequestOptions = {}
    ): Promise<string> {
        if (!input || typeof input !== "object") {
            throw new TypeError("transcription input is required");
        }
        if (!(input.audioWav instanceof Uint8Array)) {
            throw new TypeError("audioWav must be a Uint8Array");
        }
        if (input.audioWav.byteLength === 0) {
            throw new Error("audioWav must not be empty");
        }

        const externalSignal = requestOptions.signal ?? input.signal;
        if (externalSignal?.aborted) throw abortReason(externalSignal);
        const timeoutMs = checkedTimeout(
            requestOptions.timeoutMs ?? input.timeoutMs ?? this.timeoutMs
        );
        const controller = new AbortController();
        let timedOut = false;
        const abortFromCaller = (): void => {
            controller.abort(externalSignal?.reason);
        };
        if (externalSignal) {
            externalSignal.addEventListener("abort", abortFromCaller, { once: true });
        }
        const timeout = setTimeout(() => {
            timedOut = true;
            controller.abort(new Error(`transcription request timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        timeout.unref?.();

        const form = new FormData();
        form.append(
            "audio",
            new Blob([new Uint8Array(input.audioWav)], { type: "audio/wav" }),
            "audio.wav"
        );
        form.append(
            "definition",
            JSON.stringify({
                ...(input.language?.trim() ? { locales: [input.language.trim()] } : {}),
            })
        );

        try {
            const response = await this.fetchImpl(this.endpoint, {
                method: "POST",
                headers: { "Ocp-Apim-Subscription-Key": this.apiKey },
                body: form,
                signal: controller.signal,
            });
            if (!response.ok) {
                const detail = await responseText(response);
                throw new Error(
                    `transcription request failed (${response.status})${detail ? `: ${detail}` : ""}`
                );
            }

            let payload: unknown;
            try {
                payload = await response.json();
            } catch (error) {
                throw new Error(
                    `transcription response was not valid JSON: ${asError(error).message}`,
                    { cause: error }
                );
            }
            if (
                payload === null ||
                typeof payload !== "object" ||
                !("combinedPhrases" in payload) ||
                !Array.isArray(payload.combinedPhrases)
            ) {
                throw new Error("transcription response must contain combinedPhrases");
            }
            const text = payload.combinedPhrases
                .map((phrase: unknown) =>
                    phrase !== null &&
                    typeof phrase === "object" &&
                    "text" in phrase &&
                    typeof phrase.text === "string"
                        ? phrase.text.trim()
                        : ""
                )
                .filter(Boolean)
                .join(" ");
            return text;
        } catch (error) {
            if (timedOut) {
                throw new Error(`transcription request timed out after ${timeoutMs}ms`, {
                    cause: error,
                });
            }
            if (externalSignal?.aborted) throw abortReason(externalSignal);
            throw error;
        } finally {
            clearTimeout(timeout);
            if (externalSignal) {
                externalSignal.removeEventListener("abort", abortFromCaller);
            }
        }
    }
}
