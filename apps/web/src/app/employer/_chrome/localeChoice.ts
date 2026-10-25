/**
 * Which language a workspace opens in: the latest choice wins, as for the
 * theme (./themeChoice.ts).
 *
 * The account setting (`appearance.language`, per workspace member) follows
 * the person to another browser; the `ls-locale` cookie records the latest
 * choice made in this browser, on the sign-in screens or another workspace.
 * An account value never chosen (no `updatedAt`) is the registry default and
 * overrides nothing: the browser's languages already picked one.
 */

import { isLocale, type Locale, type LocaleChoice } from "~/i18n/locales";

export interface AccountLocale {
    value: unknown;
    /** When the stored value was written; null when it is the registry default. */
    updatedAt: string | null;
}

export type LocaleDecision =
    /** Switch this browser to the account's language. */
    | { kind: "apply"; locale: Locale; at: number }
    /** This browser chose later: save its choice to the account. */
    | { kind: "save"; locale: Locale }
    | { kind: "keep" };

export function decideLocale(
    account: AccountLocale,
    local: LocaleChoice | null,
    current: Locale
): LocaleDecision {
    const savedAt = account.updatedAt ? Date.parse(account.updatedAt) : Number.NaN;
    const stored = isLocale(account.value) && Number.isFinite(savedAt);
    if (local && (!stored || local.at > savedAt)) {
        return stored && local.locale === account.value
            ? { kind: "keep" }
            : { kind: "save", locale: local.locale };
    }
    if (!stored) return { kind: "keep" };
    const wanted = account.value as Locale;
    return wanted === current ? { kind: "keep" } : { kind: "apply", locale: wanted, at: savedAt };
}
