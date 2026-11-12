/**
 * The one-time note a provider takeover leaves for the browser.
 *
 * When a provider (Google, Microsoft, GitHub, the deployment's own OIDC)
 * signs in to an account whose email address was never confirmed,
 * ~/server/auth/account-linking removes the account's other ways in and sets
 * this cookie; ~/components/auth/SignInNotice reads it once and explains what
 * happened. Shared here so both sides spell it the same way.
 */
import {
    BRAND_PROVIDER_NAMES,
    OIDC_NAME_MAX_LENGTH,
    SOCIAL_PROVIDER_IDS,
} from "~/lib/auth/providers";

/** Lasts a day, not httpOnly: the browser reads it once and clears it. */
export const TAKEOVER_NOTICE_COOKIE = "ls_signin_notice";

/** The ways in a takeover can remove, by the id the server writes. */
export const TAKEOVER_METHODS = ["credential", ...SOCIAL_PROVIDER_IDS] as const;
export type TakeoverMethod = (typeof TAKEOVER_METHODS)[number];

const METHOD_NAMES: Record<TakeoverMethod, string> = {
    credential: "the password",
    google: "Google sign-in",
    microsoft: "Microsoft sign-in",
    github: "GitHub sign-in",
    oidc: "single sign-on",
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

/**
 * The cookie's value for a takeover by `providerId` that removed `removedIds`.
 * The deployment's own OIDC provider has no brand to look up, so its name
 * (AUTH_OIDC_NAME) rides along as a third, encoded part.
 */
export function formatTakeoverNotice(
    providerId: string,
    removedIds: string[],
    providerName?: string
): string {
    const base = `${providerId}:${removedIds.join("+")}`;
    return providerId === "oidc" && providerName
        ? `${base}:${encodeURIComponent(providerName)}`
        : base;
}

/** The provider's name: a brand, or the OIDC name the cookie carried. */
function noticeProviderName(providerId: string, carried: string | undefined): string | undefined {
    if (providerId in BRAND_PROVIDER_NAMES) {
        return BRAND_PROVIDER_NAMES[providerId as keyof typeof BRAND_PROVIDER_NAMES];
    }
    if (providerId !== "oidc" || !carried) return undefined;
    // Encoded once by formatTakeoverNotice; the cookie layer may or may not
    // have encoded the whole value again, so a name already decoded is fine.
    let name = carried;
    try {
        name = decodeURIComponent(carried);
    } catch {
        // "100% SSO", decoded by the outer pass already.
    }
    name = name.replace(/\s+/g, " ").trim().slice(0, OIDC_NAME_MAX_LENGTH).trim();
    return name || undefined;
}

/**
 * Reads the cookie's value as formatTakeoverNotice writes it,
 * `<provider>:<removed>+<removed>[:<oidc name>]` (e.g.
 * `google:credential+github`, `oidc:credential:Acme%20SSO`). `null` for
 * anything else, so a stray or hand-edited cookie shows nothing.
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
    const [providerId = "", removedIds = "", ...nameParts] = value.split(":");
    const provider = noticeProviderName(providerId, nameParts.join(":"));
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
