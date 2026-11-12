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
