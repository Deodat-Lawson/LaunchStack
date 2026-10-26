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
 *
 * Given the request, every sentence is in the reader's language: the route's
 * own from `growth.server.brand.errors`, a thrown one through `brandReason`.
 */
import { type NextResponse } from "next/server";

import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { isStatusCarryingError } from "~/server/api/responses";
import { brandReason } from "~/server/brand/words";
import { error, handleRouteError, json } from "~/server/distribution/http";

export { error, json };

/** The route's own sentences in the reader's language (English without a request). */
export function brandT(request?: Request) {
    return translatorFor(request ? localeOfRequest(request) : "en", "growth.server.brand.errors");
}

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
export async function brandManageContext(
    request?: Request
): Promise<{ ok: true; ctx: BrandCtx } | { ok: false; response: NextResponse }> {
    const auth = await brandContext();
    if (!auth.ok) return auth;
    if (!auth.ctx.canManage) {
        return {
            ok: false,
            response: error(brandT(request)("forbiddenManage"), 403, { code: "forbidden" }),
        };
    }
    return auth;
}

/** The context, or a 403 when the member may not speak as the workspace's accounts. */
export async function brandPublishContext(
    request?: Request
): Promise<{ ok: true; ctx: BrandCtx } | { ok: false; response: NextResponse }> {
    const auth = await brandContext();
    if (!auth.ok) return auth;
    if (!auth.ctx.canPublish) {
        return {
            ok: false,
            response: error(brandT(request)("forbiddenPublish"), 403, { code: "forbidden" }),
        };
    }
    return auth;
}

/**
 * A thrown error as a response. Brand's own errors and the marketing
 * pipeline's BrandPostError carry English sentences; with the request they
 * are worded for the reader (same `{ error, code }` shape).
 */
export function handleBrandError(scope: string, err: unknown, request?: Request): NextResponse {
    if (request && isStatusCarryingError(err) && !err.copy) {
        return error(brandReason(err.message, localeOfRequest(request)), err.status, {
            code: err.code,
        });
    }
    return handleRouteError(`brand ${scope}`, err, request);
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
    try {
        const parsed: unknown = await request.json();
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}
