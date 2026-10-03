import { getPlatformProfile } from "../../platform-profiles";
import {
    bodyText,
    credentialMismatch,
    httpFailure,
    notConfigured,
    thrownFailure,
    verifyHttpFailure,
    verifyMismatch,
    verifyThrownFailure,
} from "../classify";
import { getTwitterBearerToken } from "../config";
import type { PublishAdapter, PublishResult, VerifyResult } from "../types";

export const xAdapter: PublishAdapter = {
    platform: "x",
    async publish(request): Promise<PublishResult> {
        const { credentials, message } = request;
        const mismatch = credentialMismatch("x", credentials);
        if (mismatch) return mismatch;

        const token =
            credentials?.platform === "x" ? credentials.bearerToken : getTwitterBearerToken();
        if (!token) return notConfigured("x", "Twitter credentials not configured");

        const fetchImpl = request.fetchImpl ?? fetch;

        try {
            const limit = getPlatformProfile("x").hardCharLimit!;
            const response = await fetchImpl("https://api.twitter.com/2/tweets", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ text: message.slice(0, limit) }),
            });

            if (!response.ok) {
                const errText = await bodyText(response);
                return httpFailure(
                    "x",
                    response.status,
                    `Twitter API ${response.status}: ${errText}`
                );
            }

            const data = (await response.json()) as { data?: { id?: string } };
            const tweetId = data.data?.id;
            return {
                success: true,
                platform: "x",
                postId: tweetId,
                postUrl: tweetId ? `https://twitter.com/i/status/${tweetId}` : undefined,
            };
        } catch (err) {
            return thrownFailure("x", err);
        }
    },

    async verify(credentials, options): Promise<VerifyResult> {
        if (credentials.platform !== "x") return verifyMismatch("x", credentials);
        const fetchImpl = options?.fetchImpl ?? fetch;

        try {
            const response = await fetchImpl("https://api.twitter.com/2/users/me", {
                headers: { Authorization: `Bearer ${credentials.bearerToken}` },
            });

            // /2/users/me needs a user context. An app-only bearer token is
            // valid for read-only endpoints but gets 403 here — and could not
            // post tweets either, so the credential is unusable for publishing.
            if (response.status === 403) {
                return {
                    ok: false,
                    authFailed: true,
                    retryable: false,
                    error:
                        "X rejected the token (403): the bearer token must be a user context " +
                        "token (an OAuth 2.0 user access token with tweet.write and users.read), " +
                        "not an app-only token.",
                };
            }
            if (!response.ok) {
                const errText = await bodyText(response);
                return verifyHttpFailure(
                    response.status,
                    `Twitter API ${response.status}: ${errText}`
                );
            }

            const data = (await response.json()) as { data?: { username?: string } };
            const username = data.data?.username;
            return { ok: true, identity: username ? `@${username}` : null };
        } catch (err) {
            return verifyThrownFailure(err);
        }
    },
};
