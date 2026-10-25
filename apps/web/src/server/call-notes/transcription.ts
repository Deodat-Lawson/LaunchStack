import "server-only";

import { getTranscriptionProvider } from "@launchstack/conversion/audio-transcription";

import { env } from "~/env";
import { getEngine } from "~/server/engine";

const AZURE_TRANSCRIPTION_PATH = "/speechtotext/transcriptions:transcribe";
const AZURE_API_VERSION = "2025-10-15";
const REQUEST_TIMEOUT_MS = 20_000;

function azureEndpoint(baseUrl: string): string {
    const url = new URL(baseUrl);
    const pathname = url.pathname.replace(/\/+$/, "");
    url.pathname = pathname.endsWith(AZURE_TRANSCRIPTION_PATH)
        ? pathname
        : `${pathname}${AZURE_TRANSCRIPTION_PATH}`;
    if (!url.searchParams.has("api-version")) {
        url.searchParams.set("api-version", AZURE_API_VERSION);
    }
    return url.toString();
}

export async function transcribeCallNotesAudio(input: {
    audioWav: Uint8Array;
    language?: string;
    signal?: AbortSignal;
}): Promise<{ text: string; language?: string }> {
    input.signal?.throwIfAborted();

    if (env.server.CALL_NOTES_TRANSCRIPTION_PROVIDER !== "azure_speech") {
        // Install the configured registry before resolving its provider, just as
        // speech-to-text does. The registry has no cancellation option.
        getEngine();
        const provider = await getTranscriptionProvider();
        input.signal?.throwIfAborted();
        const result = await provider.transcribe(
            Buffer.from(input.audioWav.buffer, input.audioWav.byteOffset, input.audioWav.byteLength),
            "capture.wav",
            { mimeType: "audio/wav", timestamps: false }
        );
        input.signal?.throwIfAborted();
        return {
            text: result.data.text,
            ...(result.data.language ? { language: result.data.language } : {}),
        };
    }

    const baseUrl = env.server.CALL_NOTES_TRANSCRIPTION_BASE_URL;
    const apiKey = env.server.CALL_NOTES_TRANSCRIPTION_API_KEY;
    if (!baseUrl || !apiKey) {
        // Still fail closed when boot-time validation was explicitly skipped.
        throw new Error("Azure Speech transcription is not configured");
    }
    const language = input.language?.trim() || env.server.CALL_NOTES_TRANSCRIPTION_LANGUAGE?.trim();
    const form = new FormData();
    form.append(
        "audio",
        new Blob([new Uint8Array(input.audioWav)], { type: "audio/wav" }),
        "capture.wav"
    );
    form.append("definition", JSON.stringify(language ? { locales: [language] } : {}));

    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    const response = await fetch(azureEndpoint(baseUrl), {
        method: "POST",
        headers: { "Ocp-Apim-Subscription-Key": apiKey },
        body: form,
        signal,
    });
    if (!response.ok) {
        // Never read or attach the error body: it may contain request audio.
        throw new Error("Azure Speech transcription failed");
    }

    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        // JSON parser errors can include excerpts of the provider response.
        throw new Error("Azure Speech transcription returned invalid JSON");
    }
    if (
        payload === null ||
        typeof payload !== "object" ||
        !("combinedPhrases" in payload) ||
        !Array.isArray(payload.combinedPhrases)
    ) {
        throw new Error("Azure Speech transcription returned an invalid response");
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
    return { text };
}
