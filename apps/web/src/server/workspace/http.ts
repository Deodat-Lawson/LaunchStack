/**
 * The few things every /api/workspace route does besides calling a service.
 */

import { NextResponse } from "next/server";
import type { z } from "zod";

import { localeOfRequest } from "~/i18n/server";
import { translatorFor, wordOr } from "~/i18n/translate";
import { zodErrorText } from "~/i18n/zod";
import type { Locale } from "~/i18n/locales";
import { publicOrigin } from "~/server/public-origin";

import { isWorkspaceError } from "./errors";

/** English when there is no request to read the language from (tests, MCP). */
function localeOf(request: Request | undefined): Locale {
    return request ? localeOfRequest(request) : "en";
}

/**
 * `{ error }` with the service's status for expected failures; a logged 500
 * otherwise. With the request, the sentence is in the reader's language.
 */
export function workspaceErrorResponse(
    error: unknown,
    label: string,
    request?: Request
): NextResponse {
    const locale = localeOf(request);
    if (isWorkspaceError(error)) {
        return NextResponse.json(
            { error: wordOr(error.copy, error.message, locale), ...error.extra },
            { status: error.status }
        );
    }
    console.error(`${label} failed:`, error);
    return NextResponse.json(
        { error: translatorFor(locale, "errors.api")("internal") },
        { status: 500 }
    );
}

/** A positive integer route param, or null for anything else. */
export function parseIdParam(raw: string): number | null {
    if (!/^\d{1,18}$/.test(raw)) return null;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function invalidIdResponse(request?: Request): NextResponse {
    return NextResponse.json(
        { error: translatorFor(localeOf(request), "errors.api")("invalidId") },
        { status: 400 }
    );
}

/** Where links in outbound email and in responses should point (see publicOrigin). */
export function requestOrigin(request: Request): string {
    return publicOrigin(request);
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
    schema: z.ZodSchema<T>,
    request?: Request
): { success: true; data: T } | { success: false; response: NextResponse } {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
        const locale = localeOf(request);
        const detail = zodErrorText(parsed.error, locale, "; ");
        return {
            success: false,
            response: NextResponse.json(
                { error: translatorFor(locale, "errors.api")("invalidRequestDetail", { detail }) },
                { status: 400 }
            ),
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
            response: NextResponse.json(
                { error: translatorFor(localeOfRequest(request), "errors.api")("invalidJsonBody") },
                { status: 400 }
            ),
        };
    }
    return parseValue(json, schema, request);
}

/** Query-string params as an object, dropping empty values so optional fields stay absent. */
export function queryObject(request: Request): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of new URL(request.url).searchParams) {
        if (value.trim() !== "") out[key] = value;
    }
    return out;
}
