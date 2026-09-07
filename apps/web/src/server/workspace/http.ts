/**
 * The few things every /api/workspace route does besides calling a service.
 */

import { NextResponse } from "next/server";
import type { z } from "zod";

import { isWorkspaceError } from "./errors";

/** `{ error }` with the service's status for expected failures; a logged 500 otherwise. */
export function workspaceErrorResponse(error: unknown, label: string): NextResponse {
    if (isWorkspaceError(error)) {
        return NextResponse.json(
            { error: error.message, ...error.extra },
            { status: error.status }
        );
    }
    console.error(`${label} failed:`, error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

/** A positive integer route param, or null for anything else. */
export function parseIdParam(raw: string): number | null {
    if (!/^\d{1,18}$/.test(raw)) return null;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function invalidIdResponse(): NextResponse {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
}

/** Where links in outbound email and in responses should point. */
export function requestOrigin(request: Request): string {
    return new URL(request.url).origin;
}

/** A body that may legitimately be absent (DELETE with options). */
export async function readOptionalJson(request: Request): Promise<unknown> {
    const text = await request.text();
    if (!text.trim()) return {};
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return null;
    }
}

/** A validated body, or the `{ error }` 400 the contract promises. */
export function parseValue<T>(
    value: unknown,
    schema: z.ZodSchema<T>
): { success: true; data: T } | { success: false; response: NextResponse } {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
        const detail = parsed.error.errors
            .map(e => (e.path.length > 0 ? `${e.path.join(".")}: ${e.message}` : e.message))
            .join("; ");
        return {
            success: false,
            response: NextResponse.json({ error: `Invalid request: ${detail}` }, { status: 400 }),
        };
    }
    return { success: true, data: parsed.data };
}

export async function parseJsonBody<T>(
    request: Request,
    schema: z.ZodSchema<T>
): Promise<{ success: true; data: T } | { success: false; response: NextResponse }> {
    let json: unknown;
    try {
        json = await request.json();
    } catch {
        return {
            success: false,
            response: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }),
        };
    }
    return parseValue(json, schema);
}

/** Query-string params as an object, dropping empty values so optional fields stay absent. */
export function queryObject(request: Request): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of new URL(request.url).searchParams) {
        if (value.trim() !== "") out[key] = value;
    }
    return out;
}
