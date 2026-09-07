import { getPlatformProfile } from "../../platform-profiles";
import { getTwitterBearerToken } from "../config";
import type { PublishAdapter, PublishResult } from "../types";

export const xAdapter: PublishAdapter = {
    platform: "x",
    async publish({ message }): Promise<PublishResult> {
        const token = getTwitterBearerToken();
        if (!token) {
            return { success: false, platform: "x", error: "Twitter credentials not configured" };
        }

        try {
            const limit = getPlatformProfile("x").hardCharLimit!;
            const response = await fetch("https://api.twitter.com/2/tweets", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ text: message.slice(0, limit) }),
            });

            if (!response.ok) {
                const errText = await response.text();
                return {
                    success: false,
                    platform: "x",
                    error: `Twitter API ${response.status}: ${errText}`,
                };
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
            return {
                success: false,
                platform: "x",
                error: err instanceof Error ? err.message : "Unknown error",
            };
        }
    },
};
