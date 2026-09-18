/**
 * Shared bits for `/api/brand/*`: the workspace context and the error
 * mapping. BrandPostError carries its own status and code, which the shared
 * route handler already understands.
 */
import { type NextResponse } from "next/server";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { error, handleRouteError, json } from "~/server/distribution/http";

export { error, json };

export interface BrandCtx {
    companyId: bigint;
    userId: string;
}

export async function brandContext(): Promise<
    { ok: true; ctx: BrandCtx } | { ok: false; response: NextResponse }
> {
    const result = await requireWorkspaceContext();
    if (!result.success) return { ok: false, response: result.response };
    return {
        ok: true,
        ctx: { companyId: result.data.companyId, userId: result.data.authUserId },
    };
}

export function handleBrandError(scope: string, err: unknown): NextResponse {
    return handleRouteError(`brand ${scope}`, err);
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
    try {
        const parsed: unknown = await request.json();
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}
