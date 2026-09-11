import { getRedditCredentials } from "../config";
import type { PublishAdapter, PublishResult } from "../types";

/**
 * App-token cache, salvaged from the retired research client: Reddit tokens
 * carry an expires_in; reuse until shortly before expiry instead of
 * re-authenticating on every call (the pre-extraction behavior).
 */
const EXPIRY_BUFFER_MS = 60 * 1000;
let cachedToken: { token: string; clientId: string; expiresAt: number } | null = null;

async function getAppToken(creds: {
    clientId: string;
    clientSecret: string;
    userAgent: string;
}): Promise<string> {
    if (
        cachedToken &&
        cachedToken.clientId === creds.clientId &&
        cachedToken.expiresAt > Date.now()
    ) {
        return cachedToken.token;
    }

    const authString = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
    const tokenRes = await fetch("https://www.reddit.com/api/v1/access_token", {
        method: "POST",
        headers: {
            Authorization: `Basic ${authString}`,
            "User-Agent": creds.userAgent,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
    });
    if (!tokenRes.ok) {
        throw new Error(`Reddit auth failed: ${tokenRes.status}`);
    }

    const tokenData = (await tokenRes.json()) as { access_token: string; expires_in?: number };
    const ttlMs = (tokenData.expires_in ?? 3600) * 1000 - EXPIRY_BUFFER_MS;
    cachedToken = {
        token: tokenData.access_token,
        clientId: creds.clientId,
        expiresAt: Date.now() + Math.max(ttlMs, 0),
    };
    return cachedToken.token;
}

/** Test seam: drop the cached token. */
export function resetRedditToken(): void {
    cachedToken = null;
}

export const redditAdapter: PublishAdapter = {
    platform: "reddit",
    async publish({ message, title }): Promise<PublishResult> {
        const creds = getRedditCredentials();
        if (!creds) {
            return {
                success: false,
                platform: "reddit",
                error: "Reddit credentials not configured",
            };
        }

        try {
            // NOTE: a client_credentials (app-only) token cannot submit posts —
            // Reddit requires user-context OAuth for /api/submit. Operators must
            // supply a user-context token via the existing env vars; with an
            // app-only token Reddit responds 200 with a USER_REQUIRED error in
            // the JSON body, which the error handling below surfaces.
            const token = await getAppToken(creds);
            const postTitle = title ?? message.split("\n")[0]?.slice(0, 300) ?? "Marketing Post";

            const submitRes = await fetch("https://oauth.reddit.com/api/submit", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "User-Agent": creds.userAgent,
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    kind: "self",
                    sr: "u_me",
                    title: postTitle,
                    text: message,
                }),
            });

            if (!submitRes.ok) {
                return {
                    success: false,
                    platform: "reddit",
                    error: `Reddit submit failed: ${submitRes.status}`,
                };
            }

            // Reddit's /api/submit returns HTTP 200 even for failed submissions,
            // reporting problems in the body's `json.errors` array — so a 200
            // must be inspected before it can be treated as success.
            const submitData = (await submitRes.json().catch(() => null)) as {
                json?: {
                    errors?: unknown[];
                    data?: { url?: string; id?: string; name?: string };
                };
            } | null;
            const submitErrors = submitData?.json?.errors ?? [];
            if (submitErrors.length > 0) {
                const first = submitErrors[0];
                const detail = Array.isArray(first) ? first.join(": ") : String(first);
                return {
                    success: false,
                    platform: "reddit",
                    error: `Reddit submit failed: ${detail}`,
                };
            }

            return {
                success: true,
                platform: "reddit",
                postId: submitData?.json?.data?.name ?? submitData?.json?.data?.id,
                postUrl: submitData?.json?.data?.url,
            };
        } catch (err) {
            return {
                success: false,
                platform: "reddit",
                error: err instanceof Error ? err.message : "Unknown error",
            };
        }
    },
};
