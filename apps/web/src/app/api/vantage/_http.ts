/**
 * Shared bits for `/api/vantage/*`: the workspace context in the shape the
 * service wants, JSON helpers, and the error mapping. `VantageError` carries
 * its own status and code; anything else is a 500 with a log line.
 *
 * With the request, every sentence is in the reader's language: the
 * pipeline's `VantageError` messages and the schemas' field messages are
 * English the catalogue knows (`vantage.server.*`) and are found there again;
 * `code` values stay as they are.
 */
import { type NextResponse } from "next/server";
import { defaultErrorMap, type ZodIssue } from "zod";

import { VantageError } from "@launchstack/pipelines/vantage";

import type { Locale } from "~/i18n/locales";
import type { Messages } from "~/i18n/messages";
import { localeOfRequest } from "~/i18n/server";
import { translatorFor, wordEnglish } from "~/i18n/translate";
import { zodIssueText } from "~/i18n/zod";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import type { Permission } from "~/lib/authz/permissions";
import { error, handleRouteError, json } from "~/server/distribution/http";

export { error, json };

export interface VantageCtx {
    companyId: bigint;
    userId: string;
    can: (permission: Permission) => boolean;
}

export async function vantageContext(): Promise<
    { ok: true; ctx: VantageCtx } | { ok: false; response: NextResponse }
> {
    const result = await requireWorkspaceContext();
    if (!result.success) return { ok: false, response: result.response };
    return {
        ok: true,
        ctx: {
            companyId: result.data.companyId,
            userId: result.data.authUserId,
            can: permission => result.data.can(permission),
        },
    };
}

export function handleVantageError(scope: string, err: unknown, request?: Request): NextResponse {
    if (err instanceof VantageError) {
        const locale = request ? localeOfRequest(request) : "en";
        return error(vantageErrorText(err.message, locale), err.status, { code: err.code });
    }
    return handleRouteError(`vantage ${scope}`, err, request);
}

/** A `VantageError` message in `locale`; one the catalogue does not know stays as it is. */
export function vantageErrorText(message: string, locale: Locale): string {
    return wordEnglish(message, "vantage.server.errors", locale);
}

/** A `vantage.server.errors` sentence in the language of the person behind `request` (English without one). */
export function say(
    request: Request | undefined,
    name: keyof Messages["vantage"]["server"]["errors"]
): string {
    return translatorFor(request ? localeOfRequest(request) : "en", "vantage.server.errors")(name);
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
    try {
        const parsed: unknown = await request.json();
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

/**
 * A Zod failure as one sentence the form can show next to the control, in
 * the reader's language when the request is given: a schema's own message
 * (./_schemas) from `vantage.server.validation`, zod's default re-worded.
 */
export function firstIssue(issues: ZodIssue[], request?: Request): string {
    const locale = request ? localeOfRequest(request) : "en";
    const issue = issues[0];
    if (!issue) return translatorFor(locale, "vantage.server.errors")("checkForm");
    const message = issueText(issue, locale);
    const field = issue.path.join(".");
    return field ? `${field}: ${message}` : message;
}

function issueText(issue: ZodIssue, locale: Locale): string {
    if (locale === "en") return issue.message;
    const zodDefault = defaultErrorMap(issue, { data: undefined, defaultError: "" }).message;
    if (issue.message !== zodDefault) {
        const worded = wordEnglish(issue.message, "vantage.server.validation", locale);
        if (worded !== issue.message) return worded;
    }
    return zodIssueText(issue, locale);
}
