import { z } from "zod";

import {
    LocalCapturePollResultSchema,
    type CaptureEvent,
    type LocalCapturePollResult,
} from "@launchstack/pipelines/call-notes";

import { logWorkerEvent } from "../ipc";

const LocalBackendPollInputSchema = z
    .object({
        workerId: z.string().min(1).max(256),
        activeAttemptKey: z.string().min(1).max(512).optional(),
        wait: z.boolean().optional(),
    })
    .strict();

const LOCAL_ENDPOINT_PATH = "/api/internal/call-notes/local";

export interface LocalBackendClientOptions {
    origin: string;
    deviceToken: string;
    appVersion: string;
    timeoutMs?: number;
    fetch?: typeof fetch;
    retryBudgetMs?: number;
    retryBaseDelayMs?: number;
    retryMaxDelayMs?: number;
    random?: () => number;
    now?: () => number;
    sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
    onRetry?: (error: LocalBackendError, delayMs: number) => void;
}

export type LocalBackendPollInput = z.infer<typeof LocalBackendPollInputSchema>;
export type LocalBackendPollResult = LocalCapturePollResult;

export interface LocalBackendEventInput {
    callId: string;
    event: CaptureEvent;
}

export interface LocalBackendFinishInput {
    callId: string;
    autoEnrich: boolean;
}

interface LocalBackendPollBody extends LocalBackendPollInput {
    kind: "poll";
}

interface LocalBackendEventBody extends LocalBackendEventInput {
    kind: "event";
}

interface LocalBackendFinishBody extends LocalBackendFinishInput {
    kind: "finish";
}

type LocalBackendBody = LocalBackendPollBody | LocalBackendEventBody | LocalBackendFinishBody;

export class LocalBackendError extends Error {
    readonly retryable: boolean;
    readonly status?: number;
    readonly exhausted: boolean;
    readonly exitCode?: 75 | 77;

    constructor(
        message: string,
        options: { retryable: boolean; status?: number; exhausted?: boolean; cause?: unknown }
    ) {
        super(message, { cause: options.cause });
        this.name = "LocalBackendError";
        this.retryable = options.retryable;
        this.status = options.status;
        this.exhausted = options.exhausted ?? false;
        this.exitCode = options.status === 401 ? 77 : options.status === 426 ? 75 : undefined;
    }
}

function validOrigin(value: string): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error("Local backend origin must be a valid HTTP(S) origin");
    }
    if (
        (url.protocol !== "http:" && url.protocol !== "https:") ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
    ) {
        throw new Error("Local backend origin must be a valid HTTP(S) origin");
    }
    return url.origin;
}

function nonempty(name: string, value: string): string {
    const normalized = value.trim();
    if (!normalized) throw new Error(`${name} must not be empty`);
    return normalized;
}

function positiveOption(name: string, value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive finite number`);
    }
    return value;
}

function abortReason(signal: AbortSignal): Error {
    const reason: unknown = signal.reason;
    return reason instanceof Error
        ? reason
        : new Error(typeof reason === "string" ? reason : "local backend request aborted", {
              cause: reason,
          });
}

function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, milliseconds);
        const onAbort = (): void => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            reject(abortReason(signal!));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

export class LocalBackendClient {
    private readonly endpoint: string;
    private readonly token: string;
    private readonly appVersion: string;
    readonly longPollTimeoutMs: number;
    readonly timeoutMs: number;
    private readonly request: typeof fetch;
    private readonly retryBudgetMs: number;
    private readonly retryBaseDelayMs: number;
    private readonly retryMaxDelayMs: number;
    private readonly random: () => number;
    private readonly now: () => number;
    private readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
    private readonly onRetry?: (error: LocalBackendError, delayMs: number) => void;

    constructor(options: LocalBackendClientOptions) {
        this.endpoint = new URL(LOCAL_ENDPOINT_PATH, validOrigin(options.origin)).toString();
        this.token = nonempty("Local backend device token", options.deviceToken);
        this.appVersion = nonempty("Capture app version", options.appVersion);
        this.timeoutMs = positiveOption("timeoutMs", options.timeoutMs ?? 30_000);
        this.longPollTimeoutMs = Math.max(35_000, this.timeoutMs);
        this.request = options.fetch ?? fetch;
        this.retryBudgetMs = positiveOption("retryBudgetMs", options.retryBudgetMs ?? 120_000);
        this.retryBaseDelayMs = positiveOption("retryBaseDelayMs", options.retryBaseDelayMs ?? 250);
        this.retryMaxDelayMs = positiveOption("retryMaxDelayMs", options.retryMaxDelayMs ?? 5_000);
        this.random = options.random ?? Math.random;
        this.now = options.now ?? (() => performance.now());
        this.sleep = options.sleep ?? abortableDelay;
        this.onRetry = options.onRetry;
    }

    async poll(
        input: LocalBackendPollInput,
        signal?: AbortSignal
    ): Promise<LocalBackendPollResult> {
        const parsedInput = LocalBackendPollInputSchema.parse(input);
        const payload = await this.post({ kind: "poll", ...parsedInput }, true, signal);
        return LocalCapturePollResultSchema.parse(payload);
    }

    async event(input: LocalBackendEventInput, signal?: AbortSignal): Promise<void> {
        await this.post({ kind: "event", ...input }, false, signal);
    }

    async finish(input: LocalBackendFinishInput, signal?: AbortSignal): Promise<void> {
        await this.post({ kind: "finish", ...input }, false, signal);
    }

    private async post(
        body: LocalBackendBody,
        parseJson = false,
        externalSignal?: AbortSignal
    ): Promise<unknown> {
        const serializedBody = JSON.stringify(body);
        const startedAt = this.now();
        const budgetMs = body.kind === "poll" ? Infinity : this.retryBudgetMs;
        const timeoutMs =
            body.kind === "poll" && body.wait ? this.longPollTimeoutMs : this.timeoutMs;
        let backoffMs = Math.min(this.retryBaseDelayMs, this.retryMaxDelayMs);
        let lastError: LocalBackendError | undefined;
        const exhausted = (): LocalBackendError =>
            new LocalBackendError(
                `Local backend ${body.kind} retry budget exhausted after ${this.retryBudgetMs}ms`,
                { retryable: true, exhausted: true, status: lastError?.status, cause: lastError }
            );

        while (true) {
            if (externalSignal?.aborted) {
                const cause = abortReason(externalSignal);
                throw new LocalBackendError(cause.message, { retryable: false, cause });
            }
            const remainingMs = budgetMs - (this.now() - startedAt);
            if (remainingMs <= 0) throw exhausted();
            try {
                return await this.requestOnce(
                    serializedBody,
                    parseJson,
                    Math.min(timeoutMs, remainingMs),
                    externalSignal
                );
            } catch (error) {
                if (!(error instanceof LocalBackendError) || !error.retryable) throw error;
                lastError = error;
            }

            const remainingAfterRequestMs = budgetMs - (this.now() - startedAt);
            if (remainingAfterRequestMs <= 0) throw exhausted();
            const delayMs = Math.min(
                Math.floor(this.random() * backoffMs),
                remainingAfterRequestMs
            );
            if (this.onRetry) this.onRetry(lastError, delayMs);
            else {
                logWorkerEvent("call_worker_backend_retry", {
                    kind: body.kind,
                    message: lastError.message,
                    status: lastError.status,
                    delayMs,
                });
            }
            try {
                await this.sleep(delayMs, externalSignal);
            } catch (error) {
                if (!externalSignal?.aborted) throw error;
                const cause = abortReason(externalSignal);
                throw new LocalBackendError(cause.message, { retryable: false, cause });
            }
            backoffMs = Math.min(this.retryMaxDelayMs, backoffMs * 2);
        }
    }

    private async requestOnce(
        serializedBody: string,
        parseJson: boolean,
        timeoutMs: number,
        externalSignal?: AbortSignal
    ): Promise<unknown> {
        const controller = new AbortController();
        let timedOut = false;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let removeAbortListener: (() => void) | undefined;
        let responseStatus: number | undefined;
        const timeoutError = (): LocalBackendError =>
            new LocalBackendError(`Local backend request timed out after ${timeoutMs}ms`, {
                retryable: true,
            });

        const requestPromise = (async (): Promise<unknown> => {
            const response = await this.request(this.endpoint, {
                method: "POST",
                headers: {
                    authorization: `Bearer ${this.token}`,
                    "X-LaunchStack-Capture-Version": this.appVersion,
                    "content-type": "application/json",
                },
                body: serializedBody,
                signal: controller.signal,
            });
            responseStatus = response.status;

            const text = await response.text();
            if (!response.ok) {
                const detail = text.trim().slice(0, 512);
                throw new LocalBackendError(
                    `Local backend returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
                    {
                        retryable:
                            response.status === 429 ||
                            (response.status >= 500 && response.status <= 599),
                        status: response.status,
                    }
                );
            }
            if (!parseJson || !text.trim()) return undefined;
            try {
                return JSON.parse(text) as unknown;
            } catch {
                throw new LocalBackendError("Local backend returned invalid JSON", {
                    retryable: false,
                });
            }
        })();

        const timeoutPromise = new Promise<never>((_, reject) => {
            timeout = setTimeout(() => {
                timedOut = true;
                const error = timeoutError();
                controller.abort(error);
                reject(error);
            }, timeoutMs);
        });

        const abortPromise = externalSignal
            ? new Promise<never>((_, reject) => {
                  const onAbort = (): void => {
                      const reason = abortReason(externalSignal);
                      controller.abort(externalSignal.reason);
                      reject(reason);
                  };
                  if (externalSignal.aborted) onAbort();
                  else {
                      externalSignal.addEventListener("abort", onAbort, { once: true });
                      removeAbortListener = () =>
                          externalSignal.removeEventListener("abort", onAbort);
                  }
              })
            : undefined;

        try {
            return await Promise.race(
                [requestPromise, timeoutPromise, abortPromise].filter(
                    (value): value is Promise<unknown> => value !== undefined
                )
            );
        } catch (error) {
            if (externalSignal?.aborted) {
                const cause = abortReason(externalSignal);
                throw new LocalBackendError(cause.message, { retryable: false, cause });
            }
            if (
                responseStatus !== undefined &&
                responseStatus >= 400 &&
                responseStatus < 500 &&
                responseStatus !== 429 &&
                !(error instanceof LocalBackendError && error.status === responseStatus)
            ) {
                throw new LocalBackendError(`Local backend returned HTTP ${responseStatus}`, {
                    retryable: false,
                    status: responseStatus,
                    cause: error,
                });
            }
            if (timedOut) throw timeoutError();
            if (error instanceof LocalBackendError) throw error;
            throw new LocalBackendError(
                `Local backend request failed: ${error instanceof Error ? error.message : "unknown error"}`,
                { retryable: true, cause: error }
            );
        } finally {
            if (timeout !== undefined) clearTimeout(timeout);
            removeAbortListener?.();
        }
    }
}

export { LOCAL_ENDPOINT_PATH };
