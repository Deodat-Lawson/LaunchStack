/**
 * A fetch that waits for a slow reply as long as the caller's own timeout.
 *
 * Node's built-in fetch stops waiting for a reply's headers after five
 * minutes (undici's `headersTimeout`), whatever AbortSignal the caller set,
 * and a completion that is not streamed sends no headers until it is done. A
 * self-hosted model writing several thousand tokens takes longer than that,
 * so a longer timeout was silently cut to five minutes. This fetch uses the
 * `undici` package's own client with those limits off, leaving the caller's
 * AbortSignal as the only limit. It never mixes that client with Node's
 * bundled copy (a dispatcher from one is not safe to hand to the other).
 */
import { Agent, fetch as undiciFetch } from "undici";

/** The longest Node's built-in fetch waits for a reply's headers. */
export const NODE_FETCH_HEADERS_TIMEOUT_MS = 300_000;

let agent: Agent | undefined;

function urlOf(input: string | URL | Request): string {
    if (typeof input === "string") return input;
    return input instanceof URL ? input.href : input.url;
}

export const longWaitFetch: typeof fetch = async (input, init) => {
    // A Request carries its own method and body; keep the built-in path for it.
    if (typeof input !== "string" && !(input instanceof URL)) return fetch(input, init);
    agent ??= new Agent({ headersTimeout: 0, bodyTimeout: 0 });
    const response = await undiciFetch(urlOf(input), {
        ...(init as Parameters<typeof undiciFetch>[1]),
        dispatcher: agent,
    });
    return response as unknown as Response;
};
