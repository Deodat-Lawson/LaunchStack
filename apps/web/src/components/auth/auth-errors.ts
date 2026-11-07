/**
 * Wording for the ways signing in goes wrong. Pure functions, so the auth
 * forms stay about layout and the sentences can be tested on their own.
 *
 * None of these may reveal whether an account exists: a wrong password and
 * an unknown email read the same.
 *
 * The sentences are `auth.errors` messages. Each function takes the screen's
 * translator as its last argument; without one it answers in English, which
 * is what tests and not-yet-translated callers read.
 */

import { createTranslator, type useTranslations } from "next-intl";

import auth from "~/i18n/messages/en/auth.json";

/** `useTranslations("auth.errors")`, passed in by the screen that shows the sentence. */
export type AuthErrorsTranslator = ReturnType<typeof useTranslations<"auth.errors">>;

const english = createTranslator({
    locale: "en",
    messages: { auth },
    namespace: "auth.errors",
}) as unknown as AuthErrorsTranslator;

/** A failed better-auth call, reduced to what the forms branch on. */
export type AuthFailure = {
    /** HTTP status; 0 when the request never got an answer. */
    status: number;
    message?: string;
    /** Seconds until a rate-limited request may be retried. */
    retryAfter?: number | null;
};

export function networkErrorMessage(t: AuthErrorsTranslator = english): string {
    return t("network");
}

/** The network sentence in English. Screens use `networkErrorMessage(t)`. */
export const NETWORK_ERROR = networkErrorMessage();

/** better-auth's rate limiter answers 429 with the wait in X-Retry-After. */
export function parseRetryAfter(header: string | null): number | null {
    if (header === null) return null;
    const seconds = Number(header);
    return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
}

export function rateLimitMessage(
    retryAfter: number | null | undefined,
    t: AuthErrorsTranslator = english
): string {
    return retryAfter ? t("rateLimitWait", { seconds: retryAfter }) : t("rateLimit");
}

export function signInFailureMessage(
    failure: AuthFailure,
    t: AuthErrorsTranslator = english
): string {
    if (failure.status === 0) return networkErrorMessage(t);
    if (failure.status === 429) return rateLimitMessage(failure.retryAfter, t);
    if (failure.status === 401 || failure.status === 400) return t("wrongCredentials");
    return failure.message ?? t("signInFailed");
}

const PROVIDER_NAMES: Record<string, string> = { google: "Google", github: "GitHub" };

/**
 * The `?error=<code>` better-auth appends when a social sign-in fails, as a
 * sentence. `null` for no code. Unknown codes get a generic line rather than
 * the raw code — they are for logs, not people.
 */
export function oauthErrorMessage(
    code: string | null,
    provider?: string | null,
    t: AuthErrorsTranslator = english
): string | null {
    if (!code) return null;
    const name = provider ? PROVIDER_NAMES[provider] : undefined;
    switch (code) {
        case "access_denied":
            return t("oauth.accessDenied");
        // A provider sign-in on an existing address links to it whenever the
        // provider confirms the address (~/server/auth/account-linking), so
        // this is the one that has not.
        case "account_not_linked":
            return name
                ? t("oauth.accountNotLinked", { provider: name })
                : t("oauth.accountNotLinkedUnnamed");
        case "unable_to_link_account":
            return name
                ? t("oauth.unableToLink", { provider: name })
                : t("oauth.unableToLinkUnnamed");
        case "email_not_found":
            return name
                ? t("oauth.emailNotFound", { provider: name })
                : t("oauth.emailNotFoundUnnamed");
        case "signup_disabled":
            return t("oauth.signupDisabled");
        case "state_not_found":
        case "state_mismatch":
        case "invalid_code":
        case "invalid_callback_request":
        case "please_restart_the_process":
            return t("oauth.expired");
        default:
            return t("oauth.generic");
    }
}

/**
 * The `?error=<code>` a failed "Connect Google" in Settings › Account comes
 * back with, as a sentence. `email` is the signed-in account's address.
 */
export function connectErrorMessage(
    code: string,
    provider: string,
    email?: string | null,
    t: AuthErrorsTranslator = english
): string {
    const name = PROVIDER_NAMES[provider] ?? t("connect.fallbackProvider");
    switch (code) {
        case "access_denied":
            return t("connect.accessDenied", { provider: name });
        case "email_does_not_match":
            return email
                ? t("connect.emailMismatch", { provider: name, email })
                : t("connect.emailMismatchNoEmail", { provider: name });
        case "account_already_linked_to_different_user":
            return t("connect.alreadyLinked", { provider: name });
        case "unable_to_link_account":
            return t("connect.unconfirmed", { provider: name });
        case "state_not_found":
        case "state_mismatch":
        case "invalid_code":
        case "please_restart_the_process":
            return t("connect.expired", { provider: name });
        default:
            return t("connect.generic", { provider: name });
    }
}
