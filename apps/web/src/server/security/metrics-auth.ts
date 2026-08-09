/**
 * Bearer-token gate for the /api/metrics Prometheus endpoint.
 *
 * Keyed off METRICS_BEARER_TOKEN:
 *  - set: requests must carry `Authorization: Bearer <token>`.
 *  - unset: legacy-open compatibility mode — the endpoint stays public (as it
 *    always was) but logs one loud warning per process.
 *
 * NOTE: METRICS_BEARER_TOKEN is deliberately read from process.env here and
 * NOT registered in ~/env.ts — env.ts is frozen by a concurrent workstream.
 * The variable is optional and documented in .env.example under
 * "File access signing / service auth".
 */

import { timingSafeEqual } from "node:crypto";

function getMetricsBearerToken(): string | undefined {
    const token = process.env.METRICS_BEARER_TOKEN?.trim();
    // An empty (or whitespace-only) token must behave like an unset token, so
    // a plain `??` is not equivalent here.
    if (!token) return undefined;
    return token;
}

let warnedLegacyOpen = false;

/** Test hook: reset the once-per-process warning latch. */
export function __resetMetricsAuthWarningForTests(): void {
    warnedLegacyOpen = false;
}

function timingSafeStringEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
}

/**
 * True when the request may read metrics. Always true (with a one-time
 * warning) when METRICS_BEARER_TOKEN is unset.
 */
export function isMetricsRequestAuthorized(request: Request): boolean {
    const token = getMetricsBearerToken();
    if (!token) {
        if (!warnedLegacyOpen) {
            warnedLegacyOpen = true;
            console.warn(
                "[SECURITY] METRICS_BEARER_TOKEN is not set — /api/metrics is publicly readable (legacy compatibility mode). Set METRICS_BEARER_TOKEN to require `Authorization: Bearer`."
            );
        }
        return true;
    }

    const header = request.headers.get("authorization");
    if (!header) return false;
    return timingSafeStringEqual(header, `Bearer ${token}`);
}
