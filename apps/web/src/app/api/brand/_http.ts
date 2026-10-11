/**
 * Shared bits for `/api/brand/*`: the workspace context and the error
 * mapping. Errors that carry their own status and code (BrandPostError,
 * BrandConnectError, BrandMediaError, BrandCommentError) pass through the
 * shared route handler as expected outcomes.
 *
 * Who may do what: anyone in the workspace reads the calendar, numbers and
 * comments. Composing, scheduling, publishing, replying and syncing speak
 * as the company, so they take `social.publish` (Members and up; never a
 * Viewer or Guest). Connecting, disconnecting and switching channels decide
 * *which* accounts speak for it, so they take `connectors.manage`, like
 * every other workspace connection.
 */
import { type NextResponse } from "next/server";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { error, handleRouteError, json } from "~/server/distribution/http";

export { error, json };

export interface BrandCtx {
    companyId: bigint;
    userId: string;
    userPk: bigint;
    canManage: boolean;
    canPublish: boolean;
}

export async function brandContext(): Promise<
    { ok: true; ctx: BrandCtx } | { ok: false; response: NextResponse }
> {
    const result = await requireWorkspaceContext();
    if (!result.success) return { ok: false, response: result.response };
    return {
        ok: true,
        ctx: {
            companyId: result.data.companyId,
            userId: result.data.authUserId,
            userPk: result.data.userPk,
            canManage: result.data.can("connectors.manage"),
            canPublish: result.data.can("social.publish"),
        },
    };
}

/** The context, or a 403 when the member may not manage the workspace's accounts. */
export async function brandManageContext(): Promise<
    { ok: true; ctx: BrandCtx } | { ok: false; response: NextResponse }
> {
    const auth = await brandContext();
    if (!auth.ok) return auth;
    if (!auth.ctx.canManage) {
        return {
            ok: false,
            response: error("Only workspace admins can change connected accounts.", 403, {
                code: "forbidden",
            }),
        };
    }
    return auth;
}

/** The context, or a 403 when the member may not speak as the workspace's accounts. */
export async function brandPublishContext(): Promise<
    { ok: true; ctx: BrandCtx } | { ok: false; response: NextResponse }
> {
    const auth = await brandContext();
    if (!auth.ok) return auth;
    if (!auth.ctx.canPublish) {
        return {
            ok: false,
            response: error("Your role can read Brand but not post or reply as the company.", 403, {
                code: "forbidden",
            }),
        };
    }
    return auth;
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
