/** NDJSON chat protocol shared by the server and client. Each result is final. */
export type ChatStreamEvent<T> =
    | { type: "status"; status: string }
    | { type: "text"; delta: string }
    | { type: "reasoning"; delta: string }
    | { type: "result"; response: T }
    | { type: "error"; message: string };

export function throwIfChatAborted(signal: AbortSignal): void {
    if (signal.aborted) throw new DOMException("Response stopped", "AbortError");
}

function parseEvent<T>(line: string): ChatStreamEvent<T> {
    let value: unknown;
    try {
        value = JSON.parse(line);
    } catch {
        throw new Error("The chat stream contained malformed data. Please retry.");
    }
    if (!value || typeof value !== "object") throw new Error("Invalid chat stream event");
    const event = value as Record<string, unknown>;
    if (
        (event.type === "status" && typeof event.status === "string") ||
        ((event.type === "text" || event.type === "reasoning") &&
            typeof event.delta === "string") ||
        (event.type === "error" && typeof event.message === "string") ||
        (event.type === "result" &&
            event.response &&
            typeof event.response === "object" &&
            typeof (event.response as Record<string, unknown>).success === "boolean")
    )
        return value as ChatStreamEvent<T>;
    throw new Error("Invalid chat stream event");
}

/** Decode lines across arbitrary network and UTF-8 boundaries; never invent a final answer. */
export async function readChatStream<T>(
    response: Response,
    signal: AbortSignal,
    onEvent?: (event: ChatStreamEvent<T>) => void
): Promise<T> {
    if (!response.body) throw new Error("The chat stream is unavailable. Please retry.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    const abort = () => {
        void reader.cancel().catch(() => undefined);
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
        while (true) {
            throwIfChatAborted(signal);
            const { value, done } = await reader.read();
            throwIfChatAborted(signal);
            pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
            if (pending.length > 8_000_000)
                throw new Error("The chat stream event exceeded its size limit.");
            const lines = pending.split("\n");
            pending = lines.pop() ?? "";
            if (done && pending.trim()) {
                lines.push(pending);
                pending = "";
            }
            for (const line of lines) {
                if (!line.trim()) continue;
                const event = parseEvent<T>(line);
                throwIfChatAborted(signal);
                onEvent?.(event);
                if (event.type === "error") throw new Error(event.message);
                if (event.type === "result") return event.response;
            }
            if (done)
                throw new Error("The chat stream ended before the answer completed. Please retry.");
        }
    } finally {
        signal.removeEventListener("abort", abort);
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}

/** Browser disconnect and reader cancellation both stop the provider call. */
export function createChatStream<T>(
    requestSignal: AbortSignal,
    run: (emit: (event: ChatStreamEvent<T>) => void, signal: AbortSignal) => Promise<T>,
    onError?: (error: unknown) => string
): Response {
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    requestSignal.addEventListener("abort", abort, { once: true });
    if (requestSignal.aborted) abort();
    const encoder = new TextEncoder();
    let closed = false;
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            const emit = (event: ChatStreamEvent<T>) => {
                if (!closed && !abortController.signal.aborted) {
                    controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
                }
            };
            void (async () => {
                try {
                    throwIfChatAborted(abortController.signal);
                    const response = await run(emit, abortController.signal);
                    throwIfChatAborted(abortController.signal);
                    emit({ type: "result", response });
                } catch (error) {
                    const message = onError?.(error) ?? "The chat response failed. Please retry.";
                    if (!abortController.signal.aborted) {
                        emit({ type: "error", message });
                    }
                } finally {
                    requestSignal.removeEventListener("abort", abort);
                    if (!closed) {
                        closed = true;
                        controller.close();
                    }
                }
            })();
        },
        cancel() {
            closed = true;
            abort();
        },
    });
    return new Response(body, {
        headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    });
}
