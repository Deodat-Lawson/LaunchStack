"use client";

/**
 * Browser-side auth singleton. Components read the session through the two
 * hooks below rather than importing better-auth directly, so the session
 * shape the app depends on stays defined in one place.
 */
import { useEffect, useState } from "react";
import { createAuthClient } from "better-auth/react";
import { lastLoginMethodClient, multiSessionClient } from "better-auth/client/plugins";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";

export const authClient = createAuthClient({
    fetchOptions: {
        // Looked up on each request rather than captured when this module
        // loads, so the /dev/* harnesses can stand in for the server by
        // replacing window.fetch (/dev/workspaces shows the account menu).
        customFetchImpl: (input, init) => globalThis.fetch(input, init),
    },
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
        // Several accounts signed in at once in this browser; see
        // ~/server/auth/device-sessions and the device-account helpers below.
        multiSessionClient(),
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
        // Signs out every account signed in on this browser, not just the
        // active one (the multi-session plugin's sign-out hook). The account
        // menu on /workspaces offers the one-account version.
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

/** One account signed in on this browser, as the account menu shows it. */
export interface DeviceAccount {
    /** Names the account to set-active and revoke; never shown. */
    sessionToken: string;
    userId: string;
    name: string;
    email: string;
    image: string | null;
}

function toDeviceAccounts(data: unknown): DeviceAccount[] {
    if (!Array.isArray(data)) return [];
    const accounts: DeviceAccount[] = [];
    for (const entry of data as unknown[]) {
        if (!entry || typeof entry !== "object") continue;
        const { session, user } = entry as {
            session?: { token?: unknown };
            user?: { id?: unknown; name?: unknown; email?: unknown; image?: unknown };
        };
        if (typeof session?.token !== "string" || typeof user?.id !== "string") continue;
        accounts.push({
            sessionToken: session.token,
            userId: user.id,
            name: typeof user.name === "string" ? user.name : "",
            email: typeof user.email === "string" ? user.email : "",
            image: typeof user.image === "string" ? user.image : null,
        });
    }
    return accounts;
}

/**
 * Every account signed in on this browser, the active one included.
 *
 * A session that predates multi-session isn't remembered yet; the first call
 * remembers it (see ~/server/auth/device-sessions), so it shows up here and
 * survives adding another account.
 */
export async function listDeviceAccounts(activeSessionToken?: string): Promise<DeviceAccount[]> {
    const first = toDeviceAccounts((await authClient.multiSession.listDeviceSessions()).data);
    if (!activeSessionToken || first.some(a => a.sessionToken === activeSessionToken)) {
        return first;
    }
    await rememberActiveSession();
    return toDeviceAccounts((await authClient.multiSession.listDeviceSessions()).data);
}

/**
 * The accounts signed in on this browser, for screens that offer to switch
 * (the invitation page). Empty until loaded, and when signed out.
 */
export function useDeviceAccounts(): { accounts: DeviceAccount[]; activeUserId: string | null } {
    const { data } = authClient.useSession();
    const activeToken = data?.session.token;
    const [accounts, setAccounts] = useState<DeviceAccount[]>([]);
    useEffect(() => {
        if (!activeToken) {
            setAccounts([]);
            return;
        }
        let cancelled = false;
        listDeviceAccounts(activeToken)
            .then(list => {
                if (!cancelled) setAccounts(list);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [activeToken]);
    return { accounts, activeUserId: data?.user.id ?? null };
}

/** Makes sure the account in hand stays signed in when another is added. */
export async function rememberActiveSession(): Promise<void> {
    try {
        // An empty JSON body: Better Auth answers a body-less POST with 415.
        await authClient.$fetch("/device-sessions/remember", { method: "POST", body: {} });
    } catch {
        // Best effort: without it the worst case is the pre-multi-session
        // behaviour, where adding an account replaces this one.
    }
}

/** Makes another signed-in account the active one. Throws when it can't. */
export async function switchDeviceAccount(sessionToken: string): Promise<void> {
    const { error } = await authClient.multiSession.setActive({ sessionToken });
    if (error) throw new Error(error.message ?? "switch failed");
}

/**
 * Signs one account out of this browser. When it is the active one, the
 * server makes the next remembered account active, or none is left.
 */
export async function signOutDeviceAccount(sessionToken: string): Promise<void> {
    const { error } = await authClient.multiSession.revoke({ sessionToken });
    if (error) throw new Error(error.message ?? "sign-out failed");
}

/** Signs every account in this browser out (better-auth's plain sign-out does all of them). */
export async function signOutAllDeviceAccounts(): Promise<void> {
    const { error } = await authClient.signOut();
    if (error) throw new Error(error.message ?? "sign-out failed");
}
