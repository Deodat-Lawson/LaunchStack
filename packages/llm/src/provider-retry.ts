/** Opt-in physical retry policy. SDK and logical/structured retries remain disabled. */
export type ChatProviderStatusClass =
    | "success"
    | "rate_limited"
    | "unavailable"
    | "connection_failed"
    | "rejected"
    | "unknown"
    | "aborted"
    | "deadline";

export interface ChatProviderAttemptOutcome {
    statusClass: ChatProviderStatusClass;
    httpStatus: number | null;
    retryAfterMs?: number;
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        reasoningTokens?: number;
        cachedInputTokens?: number;
    };
}

export interface ChatProviderRetryPolicy {
    deadlineAt: number;
    beforeAttempt(info: {
        attempt: number;
        messageBytes: number;
    }): Promise<(outcome: ChatProviderAttemptOutcome) => Promise<void>>;
}

type Fetch = typeof globalThis.fetch;
const CONNECT_FAILURES = new Set([
    "ECONNREFUSED",
    "ENOTFOUND",
    "EAI_AGAIN",
    "UND_ERR_CONNECT_TIMEOUT",
]);

/** Socket resets are retryable until the first body byte. Other codes must predate headers. */
function isConnectFailure(error: unknown, beforeHeaders: boolean, receivedBody: boolean): boolean {
    const seen = new Set<unknown>();
    while (error && typeof error === "object" && !seen.has(error)) {
        seen.add(error);
        const value = error as { code?: unknown; cause?: unknown };
        if (value.code === "ECONNRESET" && !receivedBody) return true;
        if (beforeHeaders && typeof value.code === "string" && CONNECT_FAILURES.has(value.code))
            return true;
        error = value.cause;
    }
    return false;
}

function retryAfter(response: Response): number | undefined {
    const value = response.headers.get("retry-after")?.trim();
    if (!value) return undefined;
    if (/^\d+(?:\.\d+)?$/.test(value)) {
        const milliseconds = Number(value) * 1000;
        return Number.isFinite(milliseconds) ? milliseconds : undefined;
    }
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function reportedUsage(value: unknown): ChatProviderAttemptOutcome["usage"] {
    if (!value || typeof value !== "object") return undefined;
    const block = (value as { usage?: Record<string, unknown> }).usage;
    if (!block || typeof block !== "object") return undefined;
    const output = (block.completion_tokens_details ?? block.output_tokens_details) as
        | Record<string, unknown>
        | undefined;
    const input = (block.prompt_tokens_details ?? block.input_tokens_details) as
        | Record<string, unknown>
        | undefined;
    const counts = {
        inputTokens: block.prompt_tokens ?? block.input_tokens,
        outputTokens: block.completion_tokens ?? block.output_tokens,
        totalTokens: block.total_tokens,
        reasoningTokens: output?.reasoning_tokens,
        cachedInputTokens: input?.cached_tokens,
    };
    const usage = Object.fromEntries(
        Object.entries(counts).filter(
            ([, count]) => typeof count === "number" && Number.isFinite(count) && count >= 0
        )
    );
    return Object.keys(usage).length ? usage : undefined;
}

function hasGeneratedOutput(value: unknown, usage: ChatProviderAttemptOutcome["usage"]): boolean {
    if ((usage?.outputTokens ?? 0) > 0 || (usage?.reasoningTokens ?? 0) > 0) return true;
    if (!value || typeof value !== "object") return false;
    const payload = value as { choices?: unknown; output?: unknown };
    return [payload.choices, payload.output].some(output => {
        if (typeof output === "string" || Array.isArray(output)) return output.length > 0;
        return output !== null && typeof output === "object" && Object.keys(output).length > 0;
    });
}

function abortError(name: "AbortError" | "TimeoutError"): Error {
    return new DOMException(
        name === "TimeoutError"
            ? "The provider deadline expired."
            : "The provider request was aborted.",
        name
    );
}

/** A single logical fetch, with at most three journaled physical sends. */
export async function fetchWithProviderRetry(
    input: Parameters<Fetch>[0],
    init: Parameters<Fetch>[1],
    send: Fetch,
    policy: ChatProviderRetryPolicy,
    guard?: (body: string) => Promise<void>
): Promise<Response> {
    if (!Number.isFinite(policy.deadlineAt)) throw new Error("Invalid provider deadline.");
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const controller = new AbortController();
    let expired = false;
    const abort = () => controller.abort(callerSignal?.reason ?? abortError("AbortError"));
    const deadline = () => {
        expired = true;
        controller.abort(abortError("TimeoutError"));
    };
    const check = () => {
        if (Date.now() >= policy.deadlineAt) deadline();
        controller.signal.throwIfAborted();
    };
    if (callerSignal?.aborted) abort();
    else callerSignal?.addEventListener("abort", abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const armDeadline = () => {
        clearTimeout(timer);
        // Read the live policy: logical authorization can narrow a stage's deadline.
        if (!Number.isFinite(policy.deadlineAt)) throw new Error("Invalid provider deadline.");
        timer = setTimeout(
            deadline,
            Math.min(2_147_483_647, Math.max(0, policy.deadlineAt - Date.now()))
        );
    };
    const signal = controller.signal;
    const withinDeadline = async <T>(work: () => Promise<T>): Promise<T> => {
        check();
        armDeadline();
        let onAbort: (() => void) | undefined;
        const cancelled = new Promise<never>((_, reject) => {
            onAbort = () =>
                reject(signal.reason instanceof Error ? signal.reason : abortError("AbortError"));
            signal.addEventListener("abort", onAbort, { once: true });
        });
        try {
            return await Promise.race([work(), cancelled]);
        } finally {
            if (onAbort) signal.removeEventListener("abort", onAbort);
        }
    };
    const wait = async (milliseconds: number) => {
        check();
        let waitTimer: ReturnType<typeof setTimeout> | undefined;
        try {
            await withinDeadline(
                () =>
                    new Promise<void>(resolve => {
                        waitTimer = setTimeout(resolve, Math.min(milliseconds, 2_147_483_647));
                    })
            );
        } finally {
            clearTimeout(waitTimer);
        }
        check();
    };
    try {
        for (let attempt = 1; attempt <= 3; attempt++) {
            check();
            if (typeof init?.body !== "string")
                throw new Error("Expected a prepared JSON request.");
            if (guard) await guard(init.body);
            check();
            const payload: unknown = JSON.parse(init.body);
            if (
                !payload ||
                typeof payload !== "object" ||
                !("messages" in payload) ||
                !Array.isArray(payload.messages)
            )
                throw new Error("Expected prepared messages.");
            const settle = await policy.beforeAttempt({
                attempt,
                messageBytes: Buffer.byteLength(JSON.stringify(payload.messages), "utf8"),
            });
            let response: Response | undefined;
            let outcome: ChatProviderAttemptOutcome;
            let failure: unknown;
            let failed = false;
            let safeConnectionFailure = false;
            let generatedOutput = false;
            let receivedBody = false;
            let retryAfterMs: number | undefined;
            try {
                check();
                response = await withinDeadline(() => send(input, { ...init, signal }));
                const statusClass: ChatProviderStatusClass = response.ok
                    ? "success"
                    : response.status === 429
                      ? "rate_limited"
                      : response.status === 503
                        ? "unavailable"
                        : "rejected";
                retryAfterMs = retryAfter(response);
                let usage: ChatProviderAttemptOutcome["usage"];
                // Vantage uses JSON completions. Never buffer a streaming consumer's body.
                if (!response.headers.get("content-type")?.includes("text/event-stream")) {
                    // Observe the first body byte without consuming the response returned to the SDK.
                    const text = await withinDeadline(() => {
                        const watched = response!.clone().body?.pipeThrough(
                            new TransformStream<Uint8Array, Uint8Array>({
                                transform(chunk, stream) {
                                    if (chunk.byteLength > 0) receivedBody = true;
                                    stream.enqueue(chunk);
                                },
                            })
                        );
                        return new Response(watched ?? null).text();
                    });
                    try {
                        const value: unknown = JSON.parse(text);
                        usage = reportedUsage(value);
                        generatedOutput = hasGeneratedOutput(value, usage);
                    } catch {
                        // A malformed 200 remains a successful physical response, never a retry.
                    }
                } else if (!response.ok) {
                    // A streaming error cannot establish that generation never began.
                    generatedOutput = true;
                }
                check();
                outcome = {
                    statusClass,
                    httpStatus: response.status,
                    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
                    ...(usage ? { usage } : {}),
                };
            } catch (error) {
                failed = true;
                failure = error;
                safeConnectionFailure = isConnectFailure(error, !response, receivedBody);
                outcome = {
                    statusClass: expired
                        ? "deadline"
                        : signal.aborted
                          ? "aborted"
                          : safeConnectionFailure
                            ? "connection_failed"
                            : "unknown",
                    httpStatus: response?.status ?? null,
                    ...(safeConnectionFailure && retryAfterMs !== undefined ? { retryAfterMs } : {}),
                };
            }
            // Settlement failure must stop the logical call rather than repeat a possibly paid send.
            await settle(outcome);
            check();
            const retryable = !failed
                ? !generatedOutput && (response?.status === 429 || response?.status === 503)
                : safeConnectionFailure;
            if (attempt === 3 || !retryable) {
                if (failed) throw failure;
                return response!;
            }
            // Release the rejected body before the next physical connection.
            void response?.body?.cancel().catch(() => undefined);
            // Retry-After is a minimum; the absolute deadline interrupts a wait that cannot fit.
            await wait(outcome.retryAfterMs ?? Math.min(1000 * 2 ** (attempt - 1), 5000));
        }
        throw new Error("Provider attempts exhausted.");
    } finally {
        clearTimeout(timer);
        callerSignal?.removeEventListener("abort", abort);
    }
}
