/**
 * Shared bits for `/api/scenarios/*` and `/api/brand/post-tests/*`: the
 * workspace context, id parsing and the error mapping. Access rules live in
 * `~/server/scenarios/service`.
 */
import type { NextResponse } from "next/server";

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

export function handleScenarioError(scope: string, err: unknown): NextResponse {
    if (err instanceof ScenarioError)
        return error(err.message, err.status, { code: err.code, ...err.extra });
    return handleRouteError(`scenarios ${scope}`, err);
}
