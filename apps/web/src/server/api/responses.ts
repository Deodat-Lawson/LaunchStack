/**
 * The response half of the route contract: what a route returns, how a path id
 * is parsed, and how an error becomes a status.
 *
 * Deliberately free of the database and the engine. A route's response shape is
 * not a stateful concern, and coupling it to `~/server/db` would drag the whole
 * composition root into every dependency-injected route test — which is exactly
 * what happened when these lived alongside actor resolution.
 *
 * Actor resolution, which genuinely needs the database, lives in `./context`.
 */

import { NextResponse } from "next/server";

export function fail(message: string, status: number, extra?: object) {
    return NextResponse.json({ success: false, message, ...extra }, { status });
}

export function ok(data: unknown, status = 200) {
    return NextResponse.json({ success: true, data }, { status });
}

/**
 * Parse a numeric path segment. Digits only — no `1e2`, hex, or floats, all of
 * which `Number()` accepts and which would otherwise reach a query.
 */
export function parseNumericId(raw: string): number | null {
    if (!/^\d+$/.test(raw)) return null;
    const id = Number.parseInt(raw, 10);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * The idempotency key for a mutation: the `Idempotency-Key` header, falling
 * back to the request body when the header is absent OR blank — HTTP clients
 * with templated headers often send an empty value.
 */
export function idempotencyKeyFrom(
    request: Request,
    bodyKey: string | undefined
): string | undefined {
    const header = request.headers.get("Idempotency-Key")?.trim();
    if (header) return header;
    return bodyKey;
}

/** Never throws on a malformed or absent body. */
export async function readJson(request: Request): Promise<unknown> {
    try {
        return await request.json();
    } catch {
        return undefined;
    }
}

/**
 * An expected domain outcome that carries its own HTTP status — a lifecycle
 * violation, a conflicting transition, a refused edit.
 *
 * Matched structurally rather than by class so this module stays free of every
 * feature package's error types. An error exposing a numeric `status` and a
 * string `code` is treated as a deliberate, reportable outcome; an error
 * carrying a code but no status is an internal condition and stays internal.
 */
export interface StatusCarryingError extends Error {
    readonly code: string;
    readonly status: number;
}

/**
 * Matched on shape rather than on `instanceof Error`. An error that crosses a
 * job-step or worker boundary is serialized and comes back a plain object with
 * its prototype gone; refusing to recognise it there would turn every expected
 * outcome into a 500 exactly where it is hardest to debug.
 */
export function isStatusCarryingError(error: unknown): error is StatusCarryingError {
    if (typeof error !== "object" || error === null) return false;
    const candidate = error as Partial<StatusCarryingError>;
    return typeof candidate.code === "string" && typeof candidate.status === "number";
}

/**
 * Domain violations carry their own status — they are expected outcomes, not
 * server errors. Everything else is logged in full and reported generically:
 * driver, SQL and provider messages must never reach a client.
 */
export function handleRouteError(tag: string, error: unknown) {
    if (isStatusCarryingError(error)) {
        return fail(error.message, error.status, { code: error.code });
    }
    console.error(`[${tag}] failed:`, error);
    return fail("Request failed", 500);
}
