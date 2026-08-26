import { getPlatformProfile } from "../../platform-profiles";
import { getBlueskyCredentials } from "../config";
import type { PublishAdapter, PublishResult } from "../types";

/**
 * Session cache: Bluesky access JWTs live ~2h; re-authing on every publish
 * (the pre-extraction behavior) burns a network round-trip per post. 55-minute
 * reuse, salvaged from the retired research client.
 */
const SESSION_TTL_MS = 55 * 60 * 1000;
let cachedSession: { accessJwt: string; did: string; handle: string; expiresAt: number } | null =
    null;

async function getSession(handle: string, password: string) {
    if (cachedSession && cachedSession.handle === handle && cachedSession.expiresAt > Date.now()) {
        return cachedSession;
    }

    const sessionRes = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: handle, password }),
    });
    if (!sessionRes.ok) {
        throw new Error(`Bluesky auth failed: ${sessionRes.status}`);
    }

    const session = (await sessionRes.json()) as { accessJwt: string; did: string };
    cachedSession = { ...session, handle, expiresAt: Date.now() + SESSION_TTL_MS };
    return cachedSession;
}

/** Test seam: drop the cached session. */
export function resetBlueskySession(): void {
    cachedSession = null;
}

export const blueskyAdapter: PublishAdapter = {
    platform: "bluesky",
    async publish({ message }): Promise<PublishResult> {
        const creds = getBlueskyCredentials();
        if (!creds) {
            return {
                success: false,
                platform: "bluesky",
                error: "Bluesky credentials not configured",
            };
        }

        try {
            const session = await getSession(creds.handle, creds.appPassword);
            const limit = getPlatformProfile("bluesky").hardCharLimit!;

            const postRes = await fetch("https://bsky.social/xrpc/com.atproto.repo.createRecord", {
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
            });

            if (!postRes.ok) {
                const errText = await postRes.text();
                return {
                    success: false,
                    platform: "bluesky",
                    error: `Bluesky post failed: ${errText}`,
                };
            }

            const postData = (await postRes.json()) as { uri?: string };
            const rkey = postData.uri?.split("/").pop();
            return {
                success: true,
                platform: "bluesky",
                postId: postData.uri,
                postUrl: rkey ? `https://bsky.app/profile/${creds.handle}/post/${rkey}` : undefined,
            };
        } catch (err) {
            return {
                success: false,
                platform: "bluesky",
                error: err instanceof Error ? err.message : "Unknown error",
            };
        }
    },
};
