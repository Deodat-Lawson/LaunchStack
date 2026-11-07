import { z } from "zod";

import type { AudioChannel } from "@launchstack/pipelines/call-notes";

import { deferred } from "../deferred";
import { LocalBackendError } from "./backend-client";

export interface TranscriptionInput {
    audioWav: Uint8Array;
    channel: AudioChannel;
    language?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
}

export interface TranscriptionRequestOptions {
    signal?: AbortSignal;
    timeoutMs?: number;
}

export interface TranscriptionModel {
    transcribe(input: TranscriptionInput, options?: TranscriptionRequestOptions): Promise<string>;
}

export interface DeviceTranscriptionModelOptions {
    origin: string;
    deviceToken: string;
    appVersion: string;
    timeoutMs?: number;
    fetch?: typeof fetch;
}

const TranscriptionResponseSchema = z.object({ text: z.string(), language: z.string().optional() });

/** Audio and provider credentials never leave the paired deployment's device API. */
export class DeviceTranscriptionModel implements TranscriptionModel {
    private readonly endpoint: string;
    private readonly request: typeof fetch;
    private readonly headers: Record<string, string>;
    private readonly timeoutMs: number;

    constructor(options: DeviceTranscriptionModelOptions) {
        this.endpoint = new URL("/api/call-notes/devices/transcribe", options.origin).toString();
        this.headers = {
            Authorization: `Bearer ${options.deviceToken}`,
            "X-LaunchStack-Capture-Version": options.appVersion,
        };
        this.request = options.fetch ?? fetch;
        this.timeoutMs = options.timeoutMs ?? 20_000;
    }

    async transcribe(
        input: TranscriptionInput,
        options: TranscriptionRequestOptions = {}
    ): Promise<string> {
        if (
            !(input.audioWav instanceof Uint8Array) ||
            input.audioWav.byteLength === 0 ||
            input.audioWav.byteLength > 2_000_000
        ) {
            throw new Error("transcription audio must be a nonempty WAV no larger than 2 MB");
        }
        const signal = options.signal ?? input.signal;
        if (signal?.aborted) throw signal.reason;
        const timeoutMs = options.timeoutMs ?? input.timeoutMs ?? this.timeoutMs;
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
            throw new RangeError("transcription timeout must be positive");
        const controller = new AbortController();
        let removeAbort: (() => void) | undefined;
        const deadline = deferred<never>();
        const timer = setTimeout(() => {
            const error = new Error(`transcription request timed out after ${timeoutMs}ms`);
            controller.abort(error);
            deadline.reject(error);
        }, timeoutMs);
        const cancelled = deferred<never>();
        if (signal) {
            const abort = (): void => {
                controller.abort(signal.reason);
                cancelled.reject(signal.reason);
            };
            signal.addEventListener("abort", abort, { once: true });
            removeAbort = () => signal.removeEventListener("abort", abort);
        }
        const form = new FormData();
        form.append(
            "audio",
            new Blob([new Uint8Array(input.audioWav)], { type: "audio/wav" }),
            "audio.wav"
        );
        form.append("channel", input.channel);
        if (input.language) form.append("language", input.language);
        const response = (async (): Promise<string> => {
            const result = await this.request(this.endpoint, {
                method: "POST",
                headers: this.headers,
                body: form,
                signal: controller.signal,
            });
            if (!result.ok) {
                // Do not log response bodies: a transcription response can contain private speech.
                throw new LocalBackendError(`Device transcription returned HTTP ${result.status}`, {
                    status: result.status,
                    retryable: false,
                });
            }
            return TranscriptionResponseSchema.parse(await result.json()).text;
        })();
        try {
            return await Promise.race([response, deadline.promise, cancelled.promise]);
        } finally {
            clearTimeout(timer);
            removeAbort?.();
        }
    }
}
