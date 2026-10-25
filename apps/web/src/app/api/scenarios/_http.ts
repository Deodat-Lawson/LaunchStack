/**
 * Shared bits for `/api/scenarios/*` and `/api/brand/post-tests/*`: the
 * workspace context, id parsing and the error mapping. Access rules live in
 * `~/server/scenarios/service`.
 */
import type { NextResponse } from "next/server";

import { localeOfRequest, requestTranslator } from "~/i18n/server";
import { wordOr } from "~/i18n/translate";
import { parseNumericId } from "~/server/api/responses";
import { error, handleRouteError, json, readJsonBody } from "~/server/distribution/http";
import { requireWorkspaceContext, type WorkspaceContext } from "~/lib/require-workspace-context";
import { ScenarioError } from "~/server/scenarios/service";

export { error, json };

export async function scenarioContext(): Promise<
    { ok: true; ctx: WorkspaceContext } | { ok: false; response: NextResponse }
> {
    const result = await requireWorkspaceContext();
    if (!result.success) return { ok: false, response: result.response };
    return { ok: true, ctx: result.data };
}

export async function runIdFrom(params: Promise<{ id: string }>): Promise<number | null> {
    return parseNumericId((await params).id);
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
    const parsed = await readJsonBody(request);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
}

/**
 * A thrown error as a response. With the request, its sentence is in the
 * reader's language (`code` stays as it is); without it, English.
 */
export function handleScenarioError(scope: string, err: unknown, request?: Request): NextResponse {
    if (err instanceof ScenarioError) {
        const locale = request ? localeOfRequest(request) : "en";
        return error(wordOr(err.copy, err.message, locale), err.status, {
            code: err.code,
            ...err.extra,
        });
    }
    return handleRouteError(`scenarios ${scope}`, err, request);
}

/** "Scenario not found" in the language of the person behind `request`, for a malformed id. */
export function scenarioNotFound(request: Request): NextResponse {
    return error(requestTranslator(request, "scenarios.server.errors")("notFound"), 404);
}
