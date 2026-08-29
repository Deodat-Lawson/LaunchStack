/**
 * Composition root for the Gotenberg PDF-rendering client (ADR-009).
 *
 * @launchstack/rendering reads no environment — the connection settings are
 * resolved here, once, so every route renders PDFs through the same client
 * and a missing deployment shows up as `null` rather than a mid-request
 * throw. `null` is a real state, not an error: minimal stacks run without
 * Gotenberg and callers degrade with a typed 503 or a fallback renderer.
 */

import {
    createGotenbergClient,
    RenderingConfigError,
    type GotenbergClient,
} from "@launchstack/rendering";

import { env } from "~/env";

let cached: GotenbergClient | null | undefined;

export function getGotenbergClient(): GotenbergClient | null {
    if (cached !== undefined) return cached;

    if (!env.server.GOTENBERG_SERVICE_URL) {
        cached = null;
        return cached;
    }

    try {
        cached = createGotenbergClient({
            baseUrl: env.server.GOTENBERG_SERVICE_URL,
            username: env.server.GOTENBERG_SERVICE_USERNAME,
            password: env.server.GOTENBERG_SERVICE_PASSWORD,
        });
    } catch (err) {
        // A half-configured auth pair. Treat it as "not deployed" so requests
        // degrade the same way, but say why in the server log — the operator
        // is the only one who can fix it.
        if (err instanceof RenderingConfigError) {
            console.error(`[rendering] Gotenberg client not constructed: ${err.message}`);
            cached = null;
            return cached;
        }
        throw err;
    }
    return cached;
}

/** Test hook: forget the memoized client so a new env takes effect. */
export function resetGotenbergClientForTests(): void {
    cached = undefined;
}
