/**
 * The one HTTP call every image backend makes.
 *
 * Shared so the three backends cannot drift on the two things that are easy to
 * get subtly wrong: how a caller's abort is distinguished from a provider
 * failure, and what a transport error maps to. Both decisions belong in one
 * place — a backend that reported a user's cancellation as a retryable 503
 * would send callers into a retry loop over a request nobody wants any more.
 */

import { ImageGenerationError, type ImageEndpointConfig } from "./types";

/** Image generation is slow — tens of seconds is normal, unlike a chat turn. */
export const DEFAULT_IMAGE_TIMEOUT_MS = 120_000;

export async function postJson(
    url: string,
    body: unknown,
    endpoint: ImageEndpointConfig,
    extraHeaders: Record<string, string> = {},
    signal?: AbortSignal
): Promise<Response> {
    const timeout = AbortSignal.timeout(endpoint.timeoutMs ?? DEFAULT_IMAGE_TIMEOUT_MS);
    const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;

    try {
        return await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...extraHeaders,
                ...(endpoint.headers ?? {}),
            },
            body: JSON.stringify(body),
            signal: composed,
        });
    } catch (error) {
        // The caller cancelled: rethrow untouched so `signal.aborted` stays the
        // caller's own signal rather than becoming a provider error.
        if (signal?.aborted) throw error;

        const timedOut = timeout.aborted;
        throw new ImageGenerationError({
            code: timedOut ? "timeout" : "transport_error",
            message: timedOut
                ? `Image endpoint did not respond within ${endpoint.timeoutMs ?? DEFAULT_IMAGE_TIMEOUT_MS}ms`
                : `Could not reach the image endpoint: ${error instanceof Error ? error.message : String(error)}`,
            status: timedOut ? 504 : 503,
            retryable: true,
        });
    }
}

/** Bearer auth, the shape both OpenAI-compatible paths use. */
export function bearerHeaders(endpoint: ImageEndpointConfig): Record<string, string> {
    return endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {};
}
