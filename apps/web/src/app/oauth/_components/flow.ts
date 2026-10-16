"use client";

import { authClient, oauthFlowRedirect } from "~/lib/auth-client";

/**
 * Posts one step of the assistant's OAuth flow to better-auth and follows
 * where it says to go next. The auth client attaches the signed request from
 * this page's query string. Returns an error sentence on failure.
 */
export async function advanceOAuthFlow(
    path: "/oauth2/continue" | "/oauth2/consent",
    body: Record<string, unknown>
): Promise<string | null> {
    try {
        const { data, error } = await authClient.$fetch(path, { method: "POST", body });
        const next = oauthFlowRedirect(data);
        if (next) {
            window.location.assign(next);
            return null;
        }
        return (
            error?.message ??
            "LaunchStack couldn't continue the connection. Start it again from your assistant."
        );
    } catch {
        return "Couldn't reach LaunchStack. Check your connection and try again.";
    }
}
