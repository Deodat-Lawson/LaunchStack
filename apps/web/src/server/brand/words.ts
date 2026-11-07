/**
 * Brand's sentences in the reader's language. Brand writes its reasons as
 * English sentences and keeps some of them (a channel's `statusReason`, a
 * sign-in's `lastRefreshError`), and the marketing pipeline's BrandPostError
 * carries plain English too; every fixed one is in
 * `growth.server.brand.reasons`, and `brandReason` words it from there. A
 * sentence that is not (a network's own error text) comes back as it was.
 */
import type { Locale } from "~/i18n/locales";
import { wordEnglish } from "~/i18n/translate";

export function brandReason(english: string, locale: Locale): string {
    return wordEnglish(english, "growth.server.brand.reasons", locale);
}

export function brandReasonOrNull(english: string | null, locale: Locale): string | null {
    return english === null ? null : brandReason(english, locale);
}
