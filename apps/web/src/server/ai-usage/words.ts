/**
 * The words for an AI allowance, for the screen: which limit was reached,
 * when it resets, and who can raise it.
 */

import { translatorFor } from "~/i18n/translate";
import type { Locale } from "~/i18n/locales";

import type { AiAllowance } from "./quota";

/** The sentence that tells a person which limit they reached, when it resets and who can raise it. */
export function describeAllowanceReached(allowance: AiAllowance, locale: Locale): string {
    const t = translatorFor(locale, "errors.aiAllowance");
    const numbers = new Intl.NumberFormat(locale);
    const resetDate = new Intl.DateTimeFormat(locale, {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
    }).format(new Date(allowance.resetsAt));
    if (allowance.binding === "server" && allowance.server) {
        return t("server", {
            used: numbers.format(allowance.server.used),
            limit: numbers.format(allowance.server.limit),
            resetDate,
        });
    }
    return t("workspace", {
        used: numbers.format(allowance.used),
        limit: numbers.format(allowance.workspace.limit ?? 0),
        resetDate,
    });
}
