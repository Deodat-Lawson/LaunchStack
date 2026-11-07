/**
 * A refused relationship move in the reader's language. The pipeline's
 * StageTransitionError carries its English `message` and, beside it, the
 * stages and requirements involved (`details`); the words come from
 * `growth.server.stageErrors`. English readers get the pipeline's message
 * exactly as it was written.
 */
import { StageTransitionError } from "@launchstack/pipelines/distribution/stages";
import type { NextResponse } from "next/server";

import type { Locale } from "~/i18n/locales";
import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";

import { error, handleRouteError } from "./http";

const REQUIREMENT_KEY = {
    owner_required: "ownerRequired",
    next_action_required: "nextActionRequired",
    agreement_required: "agreementRequired",
} as const;

export function stageErrorText(err: StageTransitionError, locale: Locale): string {
    const details = err.details;
    if (locale === "en" || !details) return err.message;
    const t = translatorFor(locale, "growth.server.stageErrors");
    if (details.missing && details.missing.length > 0) {
        return details.missing
            .map(m => t(REQUIREMENT_KEY[m.code], { target: m.target }))
            .reduce((first, second) => t("pair", { first, second }));
    }
    switch (err.code) {
        case "unknown_stage":
            return t("unknownStage", { to: details.to });
        case "same_stage":
            return t("sameStage", { to: details.to });
        case "transition_not_allowed":
            return t("notAllowed", {
                from: details.from ?? "",
                to: details.to,
                allowed: (details.allowed ?? []).join(
                    translatorFor(locale, "growth.common")("listSeparator")
                ),
            });
        default:
            return err.message;
    }
}

/**
 * `handleRouteError` for the distribution routes, with a refused stage move
 * worded for the reader. Same shape as before: `{ error, code }` with 409.
 */
export function distributionRouteError(
    scope: string,
    err: unknown,
    request: Request
): NextResponse {
    if (err instanceof StageTransitionError)
        return error(stageErrorText(err, localeOfRequest(request)), err.status, {
            code: err.code,
        });
    return handleRouteError(scope, err, request);
}
