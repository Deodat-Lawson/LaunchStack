"use client";

/**
 * Browser-side auth singleton. Components read the session through the two
 * hooks below rather than importing better-auth directly, so the session
 * shape the app depends on stays defined in one place.
 */
import { createAuthClient } from "better-auth/react";
import { lastLoginMethodClient } from "better-auth/client/plugins";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";

export const authClient = createAuthClient({
    plugins: [
        // Reads the cookie the server's lastLoginMethod plugin sets, for the
        // sign-in page's "Last used" marker.
        lastLoginMethodClient(),
        // An assistant connecting over OAuth (see ~/server/mcp) sends the
        // person through /signin, /oauth/workspace and /oauth/consent with a
        // signed authorization request in the query string. This attaches it
        // to sign-in, continue and consent calls so better-auth can resume the
        // flow; on any page without that signature it does nothing.
        oauthProviderClient(),
    ],
});

/**
 * Where an OAuth-flow call says to go next: better-auth answers sign-in,
 * continue and consent with `{ redirect: true, url }` while an assistant's
 * authorization request is in flight.
 */
export function oauthFlowRedirect(data: unknown): string | null {
    if (!data || typeof data !== "object") return null;
    const { redirect, url } = data as { redirect?: unknown; url?: unknown };
    return redirect === true && typeof url === "string" ? url : null;
}

/**
 * Session identity for client components. The four fields are the complete
 * set the app consumes (the Clerk-era audit found no caller needing more).
 */
export function useAuth() {
    const { data, isPending } = authClient.useSession();
    return {
        userId: data?.user.id ?? null,
        isLoaded: !isPending,
        isSignedIn: Boolean(data?.user),
        signOut: (options?: { redirectUrl?: string }) =>
            authClient.signOut({
                fetchOptions: {
                    onSuccess: () => {
                        if (options?.redirectUrl) window.location.href = options.redirectUrl;
                    },
                },
            }),
    };
}

/** Profile of the signed-in user (name/email), for pre-registration flows. */
export function useUser() {
    const { data, isPending } = authClient.useSession();
    return {
        user: data?.user ?? null,
        isLoaded: !isPending,
    };
}
