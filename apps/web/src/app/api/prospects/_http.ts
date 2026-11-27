/**
 * Shared bits for `/api/prospects/*`: the workspace context in the shape the
 * service wants, and the error mapping (ProspectsError carries its status
 * and any extra fields such as `reason`; StageTransitionError becomes a 409
 * whose `reason` is the plain-words requirement). Given the request, every
 * sentence is in the reader's language; API readers keep the English.
 */
import { type NextResponse } from "next/server";

import { isCopy } from "~/i18n/copy";
import type { Locale } from "~/i18n/locales";
import { localeOfRequest, requestTranslator } from "~/i18n/server";
import { wordCopy, wordOr } from "~/i18n/translate";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { error, handleRouteError, json } from "~/server/distribution/http";
import { stageErrorText } from "~/server/distribution/stage-errors";
import { requirementCopy } from "~/server/prospects/adapter";
import {
    ProspectsError,
    StageTransitionError,
    type ProspectsCtx,
} from "~/server/prospects/service";

export { error, json };

/** The route's own sentences (`growth.server.errors`) in the reader's language. */
export function prospectsT(request: Request) {
    return requestTranslator(request, "growth.server.errors");
}

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

/** `extra` with every `Copy` in it worded. */
function wordExtra(extra: Record<string, unknown>, locale: Locale): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(extra).map(([key, value]) => [
            key,
            isCopy(value) ? wordCopy(value, locale) : value,
        ])
    );
}

export function handleProspectsError(scope: string, err: unknown, request?: Request): NextResponse {
    const locale = request ? localeOfRequest(request) : "en";
    if (err instanceof ProspectsError)
        return error(
            wordOr(err.copy, err.message, locale),
            err.status,
            wordExtra(err.extra, locale)
        );
    if (err instanceof StageTransitionError) {
        const message = stageErrorText(err, locale);
        const requirement = requirementCopy(err.code);
        return error(message, 409, {
            code: err.code,
            reason: requirement ? wordCopy(requirement, locale) : message,
        });
    }
    return handleRouteError(`prospects ${scope}`, err, request);
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
    try {
        const parsed: unknown = await request.json();
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}
