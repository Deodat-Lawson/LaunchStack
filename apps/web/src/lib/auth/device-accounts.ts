/**
 * Several accounts signed in at once in one browser (Slack/Google style).
 * Shared by the server's auth setup and the account menu, so both agree on
 * the limit and on how "add another account" is spelled in a URL.
 *
 * Better Auth's multi-session plugin keeps one signed cookie per account
 * besides the active session cookie; see ~/server/auth/device-sessions.
 */

/** How many accounts one browser can hold at once. */
export const MAX_DEVICE_ACCOUNTS = 5;

/**
 * `/signin?add=1` and `/signup?add=1`: sign in (or up) as another account
 * while staying signed in as this one. The middleware lets a signed-in
 * person through to those pages only with this flag.
 */
export const ADD_ACCOUNT_PARAM = "add";

export function isAddAccountMode(params: Pick<URLSearchParams, "get">): boolean {
    return params.get(ADD_ACCOUNT_PARAM) === "1";
}

/** `path` with the add-account flag, keeping any query it already has. */
export function withAddAccount(path: string): string {
    const separator = path.includes("?") ? "&" : "?";
    return `${path}${separator}${ADD_ACCOUNT_PARAM}=1`;
}

/** Better Auth's session cookie, without the `__Secure-` prefix it gets on HTTPS. */
const SESSION_COOKIE = "better-auth.session_token";
const MULTI_COOKIE = `${SESSION_COOKIE}_multi-`;

type NamedCookie = { name: string; value: string };

/**
 * How many accounts this browser holds, counted the way the multi-session
 * plugin counts them when it decides whether to remember a new sign-in: one
 * per `_multi-` cookie, plus the signed-in session if it has none yet (it is
 * remembered before an account is added, see ~/server/auth/device-sessions).
 * Names only: no database read, so pages and middleware can afford it.
 */
export function deviceAccountCount(cookies: readonly NamedCookie[]): number {
    const remembered = cookies.filter(c => c.name.includes(MULTI_COOKIE)).map(c => c.name);
    const active = cookies.find(
        c => c.name === SESSION_COOKIE || c.name === `__Secure-${SESSION_COOKIE}`
    );
    if (!active?.value) return remembered.length;
    // The value is "<token>.<signature>"; the plugin names a cookie after the
    // token in lower case.
    const token = safeDecode(active.value).split(".")[0]?.toLowerCase();
    const isRemembered =
        Boolean(token) && remembered.some(name => name.endsWith(`_multi-${token}`));
    return remembered.length + (isRemembered ? 0 : 1);
}

/**
 * True when one more sign-in would not be remembered: it would become the
 * active account, and switching away from it would sign it out.
 */
export function isAtAccountLimit(cookies: readonly NamedCookie[]): boolean {
    return deviceAccountCount(cookies) >= MAX_DEVICE_ACCOUNTS;
}

function safeDecode(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}
