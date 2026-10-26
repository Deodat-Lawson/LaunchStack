/**
 * Shared bits for `/api/proposals/*`: the workspace context in the shape the
 * service wants, and the error mapping (ProposalsError carries its status and
 * any extra fields such as `code`; an InsufficientCreditsError is a 402 the
 * shared handler already understands from its `status`). With the request,
 * every sentence is in the reader's language; `code` values stay as they are.
 */
import { type NextResponse } from "next/server";

import { localeOfRequest, requestTranslator } from "~/i18n/server";
import { wordOr } from "~/i18n/translate";
import type { Messages } from "~/i18n/messages";
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

export function handleProposalsError(scope: string, err: unknown, request?: Request): NextResponse {
    if (err instanceof ProposalsError) {
        const locale = request ? localeOfRequest(request) : "en";
        return error(wordOr(err.copy, err.message, locale), err.status, err.extra);
    }
    return handleRouteError(`proposals ${scope}`, err, request);
}

/** A `proposals.server.errors` sentence in the language of the person behind `request`. */
export function say(
    request: Request,
    name: keyof Messages["proposals"]["server"]["errors"]
): string {
    return requestTranslator(request, "proposals.server.errors")(name);
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
    try {
        const parsed: unknown = await request.json();
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}
