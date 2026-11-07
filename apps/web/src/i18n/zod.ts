/**
 * zod issues in the reader's language, for a route that answers with them.
 *
 * An issue's message is either one a schema was given — English from the
 * `errors.validation` catalogue (./validation), found again and translated —
 * or zod's own default, re-worded from the issue's code and limits
 * (`errors.zod`). English readers get the issue's message as it was.
 */

import { defaultErrorMap, type ZodError, type ZodIssue } from "zod";

import type { Locale } from "./locales";
import { translatorFor, wordEnglish } from "./translate";

export function zodIssueText(issue: ZodIssue, locale: Locale): string {
    if (locale === "en") return issue.message;
    const zodDefault = defaultErrorMap(issue, { data: undefined, defaultError: "" }).message;
    if (issue.message !== zodDefault) {
        return wordEnglish(issue.message, "errors.validation", locale);
    }
    return defaultIssueText(issue, locale) ?? issue.message;
}

/**
 * Every issue, `path: message`, joined the way the English joined them.
 * `pathAlways` keeps the `: ` before a path-less issue, as some routes'
 * English always had it.
 */
export function zodErrorText(
    error: ZodError,
    locale: Locale,
    separator: string,
    { pathAlways = false }: { pathAlways?: boolean } = {}
): string {
    return error.errors
        .map(issue => {
            const text = zodIssueText(issue, locale);
            return pathAlways || issue.path.length > 0 ? `${issue.path.join(".")}: ${text}` : text;
        })
        .join(locale === "en" ? separator : "；");
}

function defaultIssueText(issue: ZodIssue, locale: Locale): string | null {
    const t = translatorFor(locale, "errors.zod");
    switch (issue.code) {
        case "invalid_type":
            return issue.received === "undefined"
                ? t("required")
                : t("invalidType", { expected: issue.expected, received: issue.received });
        case "too_small": {
            const minimum = Number(issue.minimum);
            if (issue.type === "string") return t("stringTooShort", { minimum });
            if (issue.type === "array" || issue.type === "set") {
                return t("arrayTooShort", { minimum });
            }
            if (issue.type === "number" || issue.type === "bigint") {
                return issue.inclusive
                    ? t("numberTooSmall", { minimum })
                    : t("numberTooSmallExclusive", { minimum });
            }
            return null;
        }
        case "too_big": {
            const maximum = Number(issue.maximum);
            if (issue.type === "string") return t("stringTooLong", { maximum });
            if (issue.type === "array" || issue.type === "set") {
                return t("arrayTooLong", { maximum });
            }
            if (issue.type === "number" || issue.type === "bigint") {
                return issue.inclusive
                    ? t("numberTooBig", { maximum })
                    : t("numberTooBigExclusive", { maximum });
            }
            return null;
        }
        case "invalid_string":
            if (issue.validation === "email") return t("invalidEmail");
            if (issue.validation === "url") return t("invalidUrl");
            return t("invalidFormat");
        case "invalid_enum_value":
            return t("invalidOption", { options: issue.options.join(" | ") });
        case "unrecognized_keys":
            return t("unrecognizedKeys", { keys: issue.keys.join(", ") });
        case "invalid_date":
            return t("invalidDate");
        case "not_multiple_of":
            return Number(issue.multipleOf) === 1 ? t("notInteger") : t("invalid");
        default:
            return t("invalid");
    }
}
