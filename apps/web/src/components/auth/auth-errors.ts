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
        // A provider sign-in on an existing address links to it whenever the
        // provider confirms the address (~/server/auth/account-linking), so
        // this is the one that has not.
        case "account_not_linked":
            return `${name ?? "That provider"} hasn't confirmed you own this email address, so it can't sign you in to the Launchstack account that uses it. Confirm the address with ${name ?? "the provider"}, or sign in another way.`;
        case "unable_to_link_account":
            return `We couldn't connect ${name ?? "that account"} to your Launchstack account. Try again, or sign in another way.`;
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

/**
 * The `?error=<code>` a failed "Connect Google" in Settings › Account comes
 * back with, as a sentence. `email` is the signed-in account's address.
 */
export function connectErrorMessage(code: string, provider: string, email?: string | null): string {
    const name = PROVIDER_NAMES[provider] ?? "That provider";
    switch (code) {
        case "access_denied":
            return `Connecting ${name} was cancelled.`;
        case "email_does_not_match":
            return email
                ? `That ${name} account uses a different email address. Connect the ${name} account for ${email}.`
                : `That ${name} account uses a different email address from this one.`;
        case "account_already_linked_to_different_user":
            return `That ${name} account already signs in to a different Launchstack account.`;
        case "unable_to_link_account":
            return `${name} hasn't confirmed you own that email address, so it can't be connected.`;
        case "state_not_found":
        case "state_mismatch":
        case "invalid_code":
        case "please_restart_the_process":
            return `That attempt to connect ${name} expired. Please try again.`;
        default:
            return `We couldn't connect ${name}. Try again in a moment.`;
    }
}
