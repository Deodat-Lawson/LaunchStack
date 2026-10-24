"use client";

import type { useTranslations } from "next-intl";

import { authClient, oauthFlowRedirect } from "~/lib/auth-client";

/** `useTranslations("auth.oauth.flow")`, from the screen that shows the error. */
export type OAuthFlowTranslator = ReturnType<typeof useTranslations<"auth.oauth.flow">>;

/**
 * Posts one step of the assistant's OAuth flow to better-auth and follows
 * where it says to go next. The auth client attaches the signed request from
 * this page's query string. Returns an error sentence on failure: better-auth's
 * own, or one of `t`'s.
 */
export async function advanceOAuthFlow(
    path: "/oauth2/continue" | "/oauth2/consent",
    body: Record<string, unknown>,
    t: OAuthFlowTranslator
): Promise<string | null> {
    try {
        const { data, error } = await authClient.$fetch(path, { method: "POST", body });
        const next = oauthFlowRedirect(data);
        if (next) {
            window.location.assign(next);
            return null;
        }
        return error?.message ?? t("cantContinue");
    } catch {
        return t("unreachable");
    }
}
