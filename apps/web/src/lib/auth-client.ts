"use client";

/**
 * Browser-side auth singleton. Components read the session through the two
 * hooks below rather than importing better-auth directly, so the session
 * shape the app depends on stays defined in one place.
 */
import { createAuthClient } from "better-auth/react";
import { lastLoginMethodClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
    // Reads the cookie the server's lastLoginMethod plugin sets, for the
    // sign-in page's "Last used" marker.
    plugins: [lastLoginMethodClient()],
});

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
