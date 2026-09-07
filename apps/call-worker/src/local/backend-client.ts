import {
    LocalCapturePollInputSchema,
    LocalCapturePollResultSchema,
    type CaptureEvent,
    type LocalCapturePollInput,
    type LocalCapturePollResult,
} from "@launchstack/features/call-notes";

const LOCAL_ENDPOINT_PATH = "/api/internal/call-notes/local";

export interface LocalBackendClientOptions {
    webOrigin: string;
    token: string;
    timeoutMs?: number;
    fetch?: typeof fetch;
}

export type LocalBackendPollInput = LocalCapturePollInput;
export type LocalBackendPollResult = LocalCapturePollResult;

export interface LocalBackendEventInput {
    companyId: string;
    userId: string;
    callId: string;
    event: CaptureEvent;
}

export interface LocalBackendFinishInput {
    companyId: string;
    userId: string;
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

function checkedTimeout(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError("timeoutMs must be a positive finite number");
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

export class LocalBackendClient {
    private readonly endpoint: string;
    private readonly token: string;
    readonly timeoutMs: number;
    private readonly request: typeof fetch;

    constructor(options: LocalBackendClientOptions) {
        this.endpoint = new URL(LOCAL_ENDPOINT_PATH, validOrigin(options.webOrigin)).toString();
        this.token = nonempty("Local backend token", options.token);
        this.timeoutMs = checkedTimeout(options.timeoutMs ?? 30_000);
        this.request = options.fetch ?? fetch;
    }

    async poll(
        input: LocalBackendPollInput,
        signal?: AbortSignal
    ): Promise<LocalBackendPollResult> {
        const parsedInput = LocalCapturePollInputSchema.parse(input);
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
        if (externalSignal?.aborted) throw abortReason(externalSignal);

        const controller = new AbortController();
        let timedOut = false;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let removeAbortListener: (() => void) | undefined;
        const timeoutError = (): Error =>
            new Error(`Local backend request timed out after ${this.timeoutMs}ms`);

        const requestPromise = (async (): Promise<unknown> => {
            const response = await this.request(this.endpoint, {
                method: "POST",
                headers: {
                    authorization: `Bearer ${this.token}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });

            const text = await response.text();
            if (!response.ok) {
                const detail = text.trim().slice(0, 512);
                throw new Error(
                    `Local backend returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`
                );
            }
            if (!parseJson || !text.trim()) return undefined;
            try {
                return JSON.parse(text) as unknown;
            } catch {
                throw new Error("Local backend returned invalid JSON");
            }
        })();

        const timeoutPromise = new Promise<never>((_, reject) => {
            timeout = setTimeout(() => {
                timedOut = true;
                const error = timeoutError();
                controller.abort(error);
                reject(error);
            }, this.timeoutMs);
            timeout.unref?.();
        });

        const abortPromise = externalSignal
            ? new Promise<never>((_, reject) => {
                  const onAbort = (): void => {
                      const reason = abortReason(externalSignal);
                      controller.abort(externalSignal.reason);
                      reject(reason);
                  };
                  externalSignal.addEventListener("abort", onAbort, { once: true });
                  removeAbortListener = () => externalSignal.removeEventListener("abort", onAbort);
              })
            : undefined;

        try {
            return await Promise.race(
                [requestPromise, timeoutPromise, abortPromise].filter(
                    (value): value is Promise<unknown> => value !== undefined
                )
            );
        } catch (error) {
            if (timedOut) {
                throw new Error(`Local backend request timed out after ${this.timeoutMs}ms`, {
                    cause: error,
                });
            }
            if (externalSignal?.aborted) throw abortReason(externalSignal);
            if (error instanceof Error && error.message.startsWith("Local backend returned")) {
                throw error;
            }
            if (error instanceof Error && error.message === "Local backend returned invalid JSON") {
                throw error;
            }
            throw new Error(
                `Local backend request failed: ${error instanceof Error ? error.message : "unknown error"}`,
                { cause: error }
            );
        } finally {
            if (timeout !== undefined) clearTimeout(timeout);
            removeAbortListener?.();
        }
    }
}

export { LOCAL_ENDPOINT_PATH };
