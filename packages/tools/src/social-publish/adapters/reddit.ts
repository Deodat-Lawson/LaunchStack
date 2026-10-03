import {
    SocialHttpError,
    bodyText,
    credentialMismatch,
    httpFailure,
    notConfigured,
    pruneExpired,
    thrownFailure,
    verifyMismatch,
    verifyThrownFailure,
} from "../classify";
import { getRedditCredentials } from "../config";
import type { PublishAdapter, PublishResult, VerifyResult } from "../types";

interface RedditCredentials {
    clientId: string;
    clientSecret: string;
    userAgent: string;
}

/**
 * App-token cache, salvaged from the retired research client: Reddit tokens
 * carry an expires_in; reuse until shortly before expiry instead of
 * re-authenticating on every call (the pre-extraction behavior). Keyed by
 * clientId so two workspaces never share a token.
 */
const EXPIRY_BUFFER_MS = 60 * 1000;
const tokens = new Map<string, { token: string; expiresAt: number }>();

async function getAppToken(creds: RedditCredentials, fetchImpl: typeof fetch): Promise<string> {
    const cached = tokens.get(creds.clientId);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const authString = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
    const tokenRes = await fetchImpl("https://www.reddit.com/api/v1/access_token", {
        method: "POST",
        headers: {
            Authorization: `Basic ${authString}`,
            "User-Agent": creds.userAgent,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
    });
    if (!tokenRes.ok) {
        throw new SocialHttpError(tokenRes.status, `Reddit auth failed: ${tokenRes.status}`, {
            authStep: true,
        });
    }

    const tokenData = (await tokenRes.json()) as { access_token?: string; expires_in?: number };
    if (!tokenData.access_token) {
        // Reddit answers a bad client id/secret with HTTP 200 and an
        // `{"error":"invalid_grant"}`-style body — a credential problem.
        throw new SocialHttpError(tokenRes.status, "Reddit auth failed: no access token", {
            authStep: true,
        });
    }

    const ttlMs = (tokenData.expires_in ?? 3600) * 1000 - EXPIRY_BUFFER_MS;
    pruneExpired(tokens);
    tokens.set(creds.clientId, {
        token: tokenData.access_token,
        expiresAt: Date.now() + Math.max(ttlMs, 0),
    });
    return tokenData.access_token;
}

/** Test seam: drop every cached token. */
export function resetRedditToken(): void {
    tokens.clear();
}

export const redditAdapter: PublishAdapter = {
    platform: "reddit",
    async publish(request): Promise<PublishResult> {
        const { credentials, message, title } = request;
        const mismatch = credentialMismatch("reddit", credentials);
        if (mismatch) return mismatch;

        const creds: RedditCredentials | null =
            credentials?.platform === "reddit"
                ? {
                      clientId: credentials.clientId,
                      clientSecret: credentials.clientSecret,
                      userAgent: credentials.userAgent,
                  }
                : getRedditCredentials();
        if (!creds?.clientId || !creds.clientSecret || !creds.userAgent) {
            return notConfigured("reddit", "Reddit credentials not configured");
        }

        const fetchImpl = request.fetchImpl ?? fetch;

        try {
            // NOTE: a client_credentials (app-only) token cannot submit posts —
            // Reddit requires user-context OAuth for /api/submit. Operators must
            // supply a user-context token via the existing env vars; with an
            // app-only token Reddit responds 200 with a USER_REQUIRED error in
            // the JSON body, which the error handling below surfaces.
            const token = await getAppToken(creds, fetchImpl);
            const postTitle = title ?? message.split("\n")[0]?.slice(0, 300) ?? "Marketing Post";

            const submitRes = await fetchImpl("https://oauth.reddit.com/api/submit", {
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
                // A rejected token means the cached one is dead; re-auth next time.
                if (submitRes.status === 401) tokens.delete(creds.clientId);
                const errText = await bodyText(submitRes);
                return httpFailure(
                    "reddit",
                    submitRes.status,
                    `Reddit submit failed: ${submitRes.status}${errText ? ` ${errText}` : ""}`
                );
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
                const code = Array.isArray(first) ? String(first[0]) : String(first);
                const detail = Array.isArray(first) ? first.join(": ") : String(first);
                return {
                    success: false,
                    platform: "reddit",
                    error: `Reddit submit failed: ${detail}`,
                    status: submitRes.status,
                    retryable: false,
                    // USER_REQUIRED: the token has no user context, so it can never post.
                    authFailed: code === "USER_REQUIRED",
                };
            }

            return {
                success: true,
                platform: "reddit",
                postId: submitData?.json?.data?.name ?? submitData?.json?.data?.id,
                postUrl: submitData?.json?.data?.url,
            };
        } catch (err) {
            return thrownFailure("reddit", err);
        }
    },

    async verify(credentials, options): Promise<VerifyResult> {
        if (credentials.platform !== "reddit") return verifyMismatch("reddit", credentials);
        const fetchImpl = options?.fetchImpl ?? fetch;

        try {
            await getAppToken(credentials, fetchImpl);
            // An app token names the app, not a user; Reddit reports no identity here.
            return { ok: true, identity: null };
        } catch (err) {
            return verifyThrownFailure(err);
        }
    },
};
