import { BlueskyApiError, createBlueskyPost, resetBlueskySessions } from "../bluesky";
import type { BlueskyCredentials } from "../bluesky";
import { getBlueskyCredentials } from "../config";
import type { PublishAdapter, PublishRequest, PublishResult } from "../types";

/**
 * Test seam: drop cached sessions. Kept under its original name; sessions
 * now live in the Bluesky client, cached per (PDS, account) for 55 minutes.
 */
export function resetBlueskySession(): void {
    resetBlueskySessions();
}

function failure(error: string, extra: Partial<PublishResult> = {}): PublishResult {
    return { success: false, platform: "bluesky", error, ...extra };
}

/** A workspace target's account, else the deployment's env account. */
function resolveCredentials(request: PublishRequest): BlueskyCredentials | PublishResult {
    const { target } = request;
    if (target) {
        if (target.kind !== "bluesky") {
            return failure(`A ${target.kind} account cannot publish to Bluesky.`);
        }
        return {
            identifier: target.identifier,
            appPassword: target.appPassword,
            service: target.service,
        };
    }
    const env = getBlueskyCredentials();
    if (!env) return failure("Bluesky credentials not configured");
    return { identifier: env.handle, appPassword: env.appPassword };
}

export const blueskyAdapter: PublishAdapter = {
    platform: "bluesky",
    async publish(request): Promise<PublishResult> {
        const creds = resolveCredentials(request);
        if ("success" in creds) return creds;

        try {
            const post = await createBlueskyPost(creds, {
                text: request.message,
                media: request.media,
            });
            return { success: true, platform: "bluesky", postId: post.uri, postUrl: post.url };
        } catch (err) {
            if (err instanceof BlueskyApiError) {
                return failure(err.message, {
                    authFailed: err.authFailed || undefined,
                    retryable: err.retryable || undefined,
                });
            }
            return failure(err instanceof Error ? err.message : "Unknown error");
        }
    },
};
