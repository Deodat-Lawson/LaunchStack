"use client";

import { authClient } from "~/lib/auth-client";

/**
 * Drop-in replacement for Clerk's useAuth() hook.
 * Returns { isLoaded, isSignedIn, userId }.
 */
export function useAuth() {
    const { data: session, isPending } = authClient.useSession();
    return {
        isLoaded: !isPending,
        isSignedIn: !!session?.user,
        userId: session?.user?.id ?? null,
    };
}

/**
 * Clerk-compatible user shape so consuming components don't need changes.
 */
interface ClerkLikeUser {
    fullName: string | null;
    username: string | null;
    imageUrl: string | null;
    primaryEmailAddress: { emailAddress: string } | null;
    emailAddresses: { emailAddress: string }[];
}

/**
 * Drop-in replacement for Clerk's useUser() hook.
 * Maps Better Auth user fields to Clerk's shape.
 */
export function useUser(): { user: ClerkLikeUser | null; isLoaded: boolean } {
    const { data: session, isPending } = authClient.useSession();
    const betterAuthUser = session?.user;

    if (!betterAuthUser) {
        return { user: null, isLoaded: !isPending };
    }

    const user: ClerkLikeUser = {
        fullName: betterAuthUser.name ?? null,
        username: betterAuthUser.name ?? null,
        imageUrl: betterAuthUser.image ?? null,
        primaryEmailAddress: betterAuthUser.email
            ? { emailAddress: betterAuthUser.email }
            : null,
        emailAddresses: betterAuthUser.email
            ? [{ emailAddress: betterAuthUser.email }]
            : [],
    };

    return { user, isLoaded: !isPending };
}
