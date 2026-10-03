/**
 * Wording for the ways signing in goes wrong. Pure functions, so the auth
 * forms stay about layout and the sentences can be tested on their own.
 *
 * None of these may reveal whether an account exists: a wrong password and
 * an unknown email read the same.
 */

/** A failed better-auth call, reduced to what the forms branch on. */
export type AuthFailure = {
    /** HTTP status; 0 when the request never got an answer. */
    status: number;
    message?: string;
    /** Seconds until a rate-limited request may be retried. */
    retryAfter?: number | null;
};

export const NETWORK_ERROR =
    "Can't reach Launchstack right now. Check your connection and try again.";

/** better-auth's rate limiter answers 429 with the wait in X-Retry-After. */
export function parseRetryAfter(header: string | null): number | null {
    if (header === null) return null;
    const seconds = Number(header);
    return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
}

export function rateLimitMessage(retryAfter: number | null | undefined): string {
    return retryAfter
        ? `Too many attempts. Try again in ${retryAfter} second${retryAfter === 1 ? "" : "s"}.`
        : "Too many attempts. Wait a moment, then try again.";
}

export function signInFailureMessage(failure: AuthFailure): string {
    if (failure.status === 0) return NETWORK_ERROR;
    if (failure.status === 429) return rateLimitMessage(failure.retryAfter);
    if (failure.status === 401 || failure.status === 400) {
        return "That email and password don't match. Check both and try again.";
    }
    return failure.message ?? "Sign-in failed. Try again in a moment.";
}

const PROVIDER_NAMES: Record<string, string> = { google: "Google", github: "GitHub" };

/**
 * The `?error=<code>` better-auth appends when a social sign-in fails, as a
 * sentence. `null` for no code. Unknown codes get a generic line rather than
 * the raw code — they are for logs, not people.
 */
export function oauthErrorMessage(code: string | null, provider?: string | null): string | null {
    if (!code) return null;
    const name = provider ? PROVIDER_NAMES[provider] : undefined;
    switch (code) {
        case "access_denied":
            return "Sign-in was cancelled. Try again, or pick another way to sign in.";
        case "account_not_linked":
        case "unable_to_link_account":
            return "That email already has a Launchstack password. Sign in with your email and password instead.";
        case "email_not_found":
            return `${name ?? "The provider"} didn't share an email address with us, so we couldn't sign you in.`;
        case "signup_disabled":
            return "New accounts can't be created that way. Ask your workspace owner for an invitation.";
        case "state_not_found":
        case "state_mismatch":
        case "invalid_code":
        case "invalid_callback_request":
        case "please_restart_the_process":
            return "That sign-in attempt expired. Please try again.";
        default:
            return "We couldn't complete that sign-in. Try again, or use your email and password.";
    }
}
