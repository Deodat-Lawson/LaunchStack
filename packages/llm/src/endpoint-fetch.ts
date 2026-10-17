/**
 * The `fetch` every chat request leaves through.
 *
 * Two deployment rules live here because this is the one place every chat
 * request passes — app routes, pipelines, agent tool loops and structured
 * output alike, whichever helper resolved the model:
 *
 * 1. The operator's `systemInstructions` ride on every chat completion,
 *    folded into the first system message (or sent as one). A prompt builder
 *    cannot forget them.
 * 2. A provider's error body never leaves this module. Its text can name the
 *    vendor, the model id or a billing page, and errors travel far — into
 *    answer bubbles, meeting channels, run histories. The body is logged, and
 *    the SDK sees a short message keyed by status, worded so
 *    `describeChatEndpointError` can still classify it.
 */

import type { ChatEndpointConfig, ChatModelBehavior } from "./types";

type Fetch = typeof globalThis.fetch;

interface WireMessage {
    role?: unknown;
    content?: unknown;
    [key: string]: unknown;
}

function withText(content: unknown, text: string, position: "start" | "end"): unknown {
    if (typeof content === "string" && content.length > 0) {
        return position === "end" ? `${content}\n\n${text}` : `${text}\n\n${content}`;
    }
    if (Array.isArray(content)) {
        const parts = content as unknown[];
        const part = { type: "text", text };
        return position === "end" ? [...parts, part] : [part, ...parts];
    }
    return text;
}

/**
 * `body` with `instructions` added to its messages. Not a chat completion
 * body, or not JSON, comes back untouched.
 */
export function addSystemInstructions(
    body: string,
    instructions: string,
    systemRole: boolean
): string {
    let payload: unknown;
    try {
        payload = JSON.parse(body);
    } catch {
        return body;
    }
    if (!payload || typeof payload !== "object") return body;
    const request = payload as { messages?: unknown };
    const original = request.messages;
    if (!Array.isArray(original)) return body;

    const messages = original.map(message => ({ ...(message as WireMessage) }));
    const system = messages.findIndex(m => m.role === "system" || m.role === "developer");
    if (system !== -1) {
        messages[system]!.content = withText(messages[system]!.content, instructions, "end");
    } else if (systemRole) {
        messages.unshift({ role: "system", content: instructions });
    } else {
        // The model takes no system role; the first user turn carries it, as
        // `applyMessageBehavior` does for the caller's own system text.
        const user = messages.findIndex(m => m.role === "user");
        if (user === -1) messages.unshift({ role: "user", content: instructions });
        else messages[user]!.content = withText(messages[user]!.content, instructions, "start");
    }
    return JSON.stringify({ ...request, messages });
}

const MODEL_MISSING =
    /model_not_found|does not exist|unknown model|no such model|not supported for model/i;

/** What the SDK is told instead of the provider's own words. */
export function neutralErrorMessage(
    status: number,
    raw: string
): { message: string; code: string } {
    if (status === 401 || status === 403) {
        return {
            message: "unauthorized: the endpoint rejected the credential",
            code: "unauthorized",
        };
    }
    if (status === 402) {
        return { message: "insufficient credits on the AI service", code: "insufficient_credits" };
    }
    if (status === 429) {
        return { message: "rate limit reached on the AI service", code: "rate_limited" };
    }
    if (status === 404 || MODEL_MISSING.test(raw)) {
        return {
            message:
                "model_not_found: the endpoint does not serve the configured model or parameters",
            code: "model_not_found",
        };
    }
    if (status >= 500) {
        return { message: "the AI service failed to answer", code: "provider_error" };
    }
    return { message: "the AI service rejected the request", code: "invalid_request" };
}

function hostOf(url: string): string {
    try {
        return new URL(url).host;
    } catch {
        return url;
    }
}

function urlOf(input: Parameters<Fetch>[0]): string {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    return input.url;
}

/**
 * A `fetch` for the OpenAI SDK that applies both rules. `baseFetch` is read
 * per call, so a test that swaps the global after construction is honoured.
 */
export function createEndpointFetch(
    endpoint: ChatEndpointConfig,
    behavior: ChatModelBehavior,
    baseFetch?: Fetch
): Fetch {
    const instructions = endpoint.systemInstructions?.trim();
    const systemRole = behavior.parameters.systemMessages === "supported";

    return async (input, init) => {
        const url = urlOf(input);
        const send =
            instructions && typeof init?.body === "string" && /\/chat\/completions\/?$/.test(url)
                ? { ...init, body: addSystemInstructions(init.body, instructions, systemRole) }
                : init;

        const response = await (baseFetch ?? globalThis.fetch)(input, send);
        if (response.ok) return response;

        const raw = await response.text().catch(() => "");
        console.error(
            `[chat] ${hostOf(url)} answered ${response.status}: ${raw.slice(0, 1000) || "(empty body)"}`
        );
        const { message, code } = neutralErrorMessage(response.status, raw);
        const headers = new Headers(response.headers);
        for (const name of ["content-length", "content-encoding", "transfer-encoding"]) {
            headers.delete(name);
        }
        headers.set("content-type", "application/json");
        return new Response(JSON.stringify({ error: { message, type: code, code } }), {
            status: response.status,
            statusText: response.statusText,
            headers,
        });
    };
}
