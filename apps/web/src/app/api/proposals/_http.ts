/**
 * Shared bits for `/api/proposals/*`: the workspace context in the shape the
 * service wants, and the error mapping (ProposalsError carries its status and
 * any extra fields such as `code`; an InsufficientCreditsError is a 402 the
 * shared handler already understands from its `status`).
 */
import { type NextResponse } from "next/server";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { error, handleRouteError, json } from "~/server/distribution/http";
import { ProposalsError, type ProposalsCtx } from "~/server/proposals/service";

export { error, json };

export async function proposalsContext(): Promise<
    { ok: true; ctx: ProposalsCtx } | { ok: false; response: NextResponse }
> {
    const result = await requireWorkspaceContext();
    if (!result.success) return { ok: false, response: result.response };
    return {
        ok: true,
        ctx: { companyId: result.data.companyId, userId: result.data.authUserId },
    };
}

export function handleProposalsError(scope: string, err: unknown): NextResponse {
    if (err instanceof ProposalsError) return error(err.message, err.status, err.extra);
    return handleRouteError(`proposals ${scope}`, err);
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
    try {
        const parsed: unknown = await request.json();
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}
