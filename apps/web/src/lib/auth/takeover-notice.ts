/**
 * The one-time note a provider takeover leaves for the browser.
 *
 * When Google or GitHub signs in to an account whose email address was never
 * confirmed, ~/server/auth/account-linking removes the account's other ways
 * in and sets this cookie; ~/components/auth/SignInNotice reads it once and
 * explains what happened. Shared here so both sides spell it the same way.
 */

/** Short-lived, not httpOnly: the browser reads it and clears it. */
export const TAKEOVER_NOTICE_COOKIE = "ls_signin_notice";

const PROVIDER_NAMES: Record<string, string> = { google: "Google", github: "GitHub" };

const METHOD_NAMES: Record<string, string> = {
    credential: "the password",
    google: "Google sign-in",
    github: "GitHub sign-in",
};

/** What the one-time notice after a provider takeover tells the person. */
export interface TakeoverNotice {
    /** The provider they just signed in with, by name. */
    provider: string;
    /** What it replaced, as a phrase: "the password and GitHub sign-in". */
    removed: string;
    /** More than one thing was removed ("were", not "was"). */
    plural: boolean;
    passwordRemoved: boolean;
}

/** The cookie's value for a takeover by `providerId` that removed `removedIds`. */
export function formatTakeoverNotice(providerId: string, removedIds: string[]): string {
    return `${providerId}:${removedIds.join("+")}`;
}

/**
 * Reads the cookie's value as formatTakeoverNotice writes it,
 * `<provider>:<removed>+<removed>` (e.g. `google:credential+github`). `null`
 * for anything else, so a stray or hand-edited cookie shows nothing.
 */
export function parseTakeoverNotice(raw: string | null | undefined): TakeoverNotice | null {
    if (!raw) return null;
    let value: string;
    try {
        value = decodeURIComponent(raw);
    } catch {
        return null;
    }
    const [providerId = "", removedIds = ""] = value.split(":");
    const provider = PROVIDER_NAMES[providerId];
    const ids = removedIds.split("+").filter(id => id in METHOD_NAMES);
    if (!provider || ids.length === 0) return null;
    const names = ids.map(id => METHOD_NAMES[id]!);
    const removed =
        names.length === 1
            ? names[0]!
            : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    return {
        provider,
        removed,
        plural: names.length > 1,
        passwordRemoved: ids.includes("credential"),
    };
}
