/**
 * The one-time note a provider takeover leaves for the browser.
 *
 * When Google or GitHub signs in to an account whose email address was never
 * confirmed, ~/server/auth/account-linking removes the account's other ways
 * in and sets this cookie; ~/components/auth/SignInNotice reads it once and
 * explains what happened. Shared here so both sides spell it the same way.
 */

/** Lasts a day, not httpOnly: the browser reads it once and clears it. */
export const TAKEOVER_NOTICE_COOKIE = "ls_signin_notice";

const PROVIDER_NAMES: Record<string, string> = { google: "Google", github: "GitHub" };

/** The ways in a takeover can remove, by the id the server writes. */
export const TAKEOVER_METHODS = ["credential", "google", "github"] as const;
export type TakeoverMethod = (typeof TAKEOVER_METHODS)[number];

const METHOD_NAMES: Record<TakeoverMethod, string> = {
    credential: "the password",
    google: "Google sign-in",
    github: "GitHub sign-in",
};

function isTakeoverMethod(id: string): id is TakeoverMethod {
    return (TAKEOVER_METHODS as readonly string[]).includes(id);
}

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

/** The same note, with what was removed as ids for the screen to name in its language. */
export interface TakeoverNoticeMethods {
    /** The provider they just signed in with, by name. */
    provider: string;
    removed: TakeoverMethod[];
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
export function parseTakeoverNoticeMethods(
    raw: string | null | undefined
): TakeoverNoticeMethods | null {
    if (!raw) return null;
    let value: string;
    try {
        value = decodeURIComponent(raw);
    } catch {
        return null;
    }
    const [providerId = "", removedIds = ""] = value.split(":");
    const provider = PROVIDER_NAMES[providerId];
    const removed = removedIds.split("+").filter(isTakeoverMethod);
    if (!provider || removed.length === 0) return null;
    return { provider, removed };
}

/** `parseTakeoverNoticeMethods`, with what was removed as one English phrase. */
export function parseTakeoverNotice(raw: string | null | undefined): TakeoverNotice | null {
    const parsed = parseTakeoverNoticeMethods(raw);
    if (!parsed) return null;
    const names = parsed.removed.map(id => METHOD_NAMES[id]);
    const removed =
        names.length === 1
            ? names[0]!
            : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    return {
        provider: parsed.provider,
        removed,
        plural: names.length > 1,
        passwordRemoved: parsed.removed.includes("credential"),
    };
}
