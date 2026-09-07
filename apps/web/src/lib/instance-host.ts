"use client";

import { useEffect, useState } from "react";

/**
 * The host this instance is actually served from, for display.
 *
 * Workspace URLs used to be rendered as a hardcoded "launchstack.app/<slug>",
 * which is wrong on every deployment except the hosted one — a self-hoster
 * creating a workspace was shown someone else's domain as their own.
 *
 * NEXT_PUBLIC_APP_URL is the build-time answer and the same variable the
 * public site uses to point at this app. window.location.host is the runtime
 * answer and is always right, including for someone who never set the variable
 * — which is the common case for a self-hoster. Reading it in an effect rather
 * than during render keeps the first client render identical to the server's,
 * so there is no hydration mismatch.
 */
const CONFIGURED_HOST = (() => {
    const raw = process.env.NEXT_PUBLIC_APP_URL;
    if (!raw) return null;
    try {
        return new URL(raw).host;
    } catch {
        return null;
    }
})();

export function useInstanceHost(): string {
    const [host, setHost] = useState<string>(CONFIGURED_HOST ?? "");

    useEffect(() => {
        if (typeof window !== "undefined") {
            setHost(window.location.host);
        }
    }, []);

    return host;
}
