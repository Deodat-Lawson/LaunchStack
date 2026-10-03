import { getPlatformProfile } from "../../platform-profiles";
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
import { getBlueskyCredentials } from "../config";
import type { PublishAdapter, PublishResult, VerifyResult } from "../types";

/**
 * Session cache: Bluesky access JWTs live ~2h; re-authing on every publish
 * (the pre-extraction behavior) burns a network round-trip per post. 55-minute
 * reuse, salvaged from the retired research client. Keyed by handle so two
 * workspaces never share a session.
 */
const SESSION_TTL_MS = 55 * 60 * 1000;
interface CachedSession {
    accessJwt: string;
    did: string;
    handle: string;
    expiresAt: number;
}
const sessions = new Map<string, CachedSession>();

async function getSession(
    handle: string,
    password: string,
    fetchImpl: typeof fetch
): Promise<CachedSession> {
    const cached = sessions.get(handle);
    if (cached && cached.expiresAt > Date.now()) return cached;

    const sessionRes = await fetchImpl(
        "https://bsky.social/xrpc/com.atproto.server.createSession",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identifier: handle, password }),
        }
    );
    if (!sessionRes.ok) {
        const errText = await bodyText(sessionRes);
        throw new SocialHttpError(
            sessionRes.status,
            `Bluesky auth failed: ${sessionRes.status}${errText ? ` ${errText}` : ""}`,
            { authStep: true }
        );
    }

    const session = (await sessionRes.json()) as {
        accessJwt: string;
        did: string;
        handle?: string;
    };
    const entry: CachedSession = {
        accessJwt: session.accessJwt,
        did: session.did,
        handle: session.handle ?? handle,
        expiresAt: Date.now() + SESSION_TTL_MS,
    };
    pruneExpired(sessions);
    sessions.set(handle, entry);
    return entry;
}

/** Test seam: drop every cached session. */
export function resetBlueskySession(): void {
    sessions.clear();
}

export const blueskyAdapter: PublishAdapter = {
    platform: "bluesky",
    async publish(request): Promise<PublishResult> {
        const { credentials, message } = request;
        const mismatch = credentialMismatch("bluesky", credentials);
        if (mismatch) return mismatch;

        const creds =
            credentials?.platform === "bluesky"
                ? { handle: credentials.handle, appPassword: credentials.appPassword }
                : getBlueskyCredentials();
        if (!creds?.handle || !creds.appPassword) {
            return notConfigured("bluesky", "Bluesky credentials not configured");
        }

        const fetchImpl = request.fetchImpl ?? fetch;

        try {
            const session = await getSession(creds.handle, creds.appPassword, fetchImpl);
            const limit = getPlatformProfile("bluesky").hardCharLimit!;

            const postRes = await fetchImpl(
                "https://bsky.social/xrpc/com.atproto.repo.createRecord",
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${session.accessJwt}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        repo: session.did,
                        collection: "app.bsky.feed.post",
                        record: {
                            text: message.slice(0, limit),
                            createdAt: new Date().toISOString(),
                        },
                    }),
                }
            );

            if (!postRes.ok) {
                // A rejected JWT means the cached session is dead; re-auth next time.
                if (postRes.status === 401) sessions.delete(creds.handle);
                const errText = await bodyText(postRes);
                return httpFailure("bluesky", postRes.status, `Bluesky post failed: ${errText}`);
            }

            const postData = (await postRes.json()) as { uri?: string };
            const rkey = postData.uri?.split("/").pop();
            return {
                success: true,
                platform: "bluesky",
                postId: postData.uri,
                postUrl: rkey
                    ? `https://bsky.app/profile/${session.handle}/post/${rkey}`
                    : undefined,
            };
        } catch (err) {
            return thrownFailure("bluesky", err);
        }
    },

    async verify(credentials, options): Promise<VerifyResult> {
        if (credentials.platform !== "bluesky") return verifyMismatch("bluesky", credentials);
        const fetchImpl = options?.fetchImpl ?? fetch;

        try {
            const session = await getSession(
                credentials.handle,
                credentials.appPassword,
                fetchImpl
            );
            return { ok: true, identity: session.handle };
        } catch (err) {
            return verifyThrownFailure(err);
        }
    },
};
