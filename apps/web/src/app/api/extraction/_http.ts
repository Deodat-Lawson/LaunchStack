/**
 * Shared bits for `/api/extraction/*`: the workspace context, id parsing and
 * the error mapping. Access rules live in `~/server/extraction/service`.
 */
import type { NextResponse } from "next/server";

import { localeOfRequest, requestTranslator } from "~/i18n/server";
import { wordCopy } from "~/i18n/translate";
import { requireWorkspaceContext, type WorkspaceContext } from "~/lib/require-workspace-context";
import { parseNumericId } from "~/server/api/responses";
import { error, handleRouteError, json, readJsonBody } from "~/server/distribution/http";
import { ExtractionError } from "~/server/extraction/service";

export { error, json };

export async function extractionContext(): Promise<
    { ok: true; ctx: WorkspaceContext } | { ok: false; response: NextResponse }
> {
    const result = await requireWorkspaceContext();
    if (!result.success) return { ok: false, response: result.response };
    return { ok: true, ctx: result.data };
}

export async function tableIdFrom(params: Promise<{ id: string }>): Promise<number | null> {
    return parseNumericId((await params).id);
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
    const parsed = await readJsonBody(request);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
}

/** A thrown error as a response, its sentence in the reader's language (`code` stays as it is). */
export function handleExtractionError(scope: string, err: unknown, request: Request): NextResponse {
    if (err instanceof ExtractionError) {
        return error(wordCopy(err.copy, localeOfRequest(request)), err.status, { code: err.code });
    }
    return handleRouteError(`extraction ${scope}`, err, request);
}

/** "Table not found" in the language of the person behind `request`, for a malformed id. */
export function tableNotFound(request: Request): NextResponse {
    return error(requestTranslator(request, "extractServer.errors")("notFound"), 404, {
        code: "not_found",
    });
}
