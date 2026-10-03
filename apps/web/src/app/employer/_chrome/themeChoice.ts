/**
 * Which theme a workspace opens in: the latest choice wins.
 *
 * Two records can disagree. The account setting (`appearance.theme`, saved
 * per workspace member) follows the person to another browser; the
 * `ls-theme` cookie records the latest choice made in this browser, on the
 * landing site, the sign-in screens or another workspace. Whichever was
 * chosen more recently is the one the person expects to see.
 */

import { isThemeName, type ThemeChoice, type ThemeName } from "@launchstack/design-tokens/theme";

export interface AccountTheme {
    value: unknown;
    /** When the stored value was written; null when it is the registry default. */
    updatedAt: string | null;
}

export interface ThemeDecision {
    theme: ThemeName;
    /** True when this browser's newer choice should be saved to the account. */
    save: boolean;
}

export function decideTheme(
    account: AccountTheme,
    local: ThemeChoice | null
): ThemeDecision | null {
    if (!isThemeName(account.value)) return null;
    const savedAt = account.updatedAt ? Date.parse(account.updatedAt) : 0;
    if (local && local.at > (Number.isFinite(savedAt) ? savedAt : 0)) {
        return { theme: local.theme, save: local.theme !== account.value };
    }
    return { theme: account.value, save: false };
}
