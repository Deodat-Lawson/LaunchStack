/**
 * Shared bits for `/api/prospects/*`: the workspace context in the shape the
 * service wants, and the error mapping (ProspectsError carries its status
 * and any extra fields such as `reason`; StageTransitionError becomes a 409
 * whose `reason` is the plain-words requirement).
 */
import { type NextResponse } from "next/server";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { error, handleRouteError, json } from "~/server/distribution/http";
import { REQUIREMENT_WORDS } from "~/server/prospects/adapter";
import {
    ProspectsError,
    StageTransitionError,
    type ProspectsCtx,
} from "~/server/prospects/service";

export { error, json };

export async function prospectsContext(): Promise<
    { ok: true; ctx: ProspectsCtx } | { ok: false; response: NextResponse }
> {
    const result = await requireWorkspaceContext();
    if (!result.success) return { ok: false, response: result.response };
    return {
        ok: true,
        ctx: {
            companyId: result.data.companyId,
            userId: result.data.authUserId,
            userPk: result.data.userPk,
        },
    };
}

export function handleProspectsError(scope: string, err: unknown): NextResponse {
    if (err instanceof ProspectsError) return error(err.message, err.status, err.extra);
    if (err instanceof StageTransitionError)
        return error(err.message, 409, {
            code: err.code,
            reason: REQUIREMENT_WORDS[err.code] ?? err.message,
        });
    return handleRouteError(`prospects ${scope}`, err);
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
    try {
        const parsed: unknown = await request.json();
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}
