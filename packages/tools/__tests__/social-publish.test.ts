import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    publishToPlatform,
    resetBlueskySession,
    resetRedditToken,
} from "@launchstack/tools/social-publish";

const savedEnv = { ...process.env };

function restoreEnv() {
    for (const key of [
        "TWITTER_BEARER_TOKEN",
        "BLUESKY_HANDLE",
        "BLUESKY_APP_PASSWORD",
        "REDDIT_CLIENT_ID",
        "REDDIT_CLIENT_SECRET",
        "REDDIT_USER_AGENT",
        "LINKEDIN_ACCESS_TOKEN",
    ]) {
        const value = savedEnv[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
}

describe("social-publish", () => {
    beforeEach(() => {
        resetBlueskySession();
        resetRedditToken();
    });
    afterEach(() => {
        restoreEnv();
        vi.unstubAllGlobals();
    });

    it("returns a per-platform config error without touching the network", async () => {
        delete process.env.TWITTER_BEARER_TOKEN;
        const fetchSpy = vi.fn();
        vi.stubGlobal("fetch", fetchSpy);

        const result = await publishToPlatform({ platform: "x", message: "hello" });
        expect(result.success).toBe(false);
        expect(result.error).toContain("credentials not configured");
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("truncates X posts to the profile's hard limit and returns the post id", async () => {
        process.env.TWITTER_BEARER_TOKEN = "t";
        const fetchSpy = vi.fn(async (_url: string, init?: { body?: string }) => {
            const body = JSON.parse(init!.body!) as { text: string };
            expect(body.text).toHaveLength(280);
            return new Response(JSON.stringify({ data: { id: "12345" } }), { status: 201 });
        });
        vi.stubGlobal("fetch", fetchSpy);

        const result = await publishToPlatform({ platform: "x", message: "y".repeat(400) });
        expect(result.success).toBe(true);
        expect(result.postId).toBe("12345");
        expect(result.postUrl).toBe("https://twitter.com/i/status/12345");
    });

    it("caches the Bluesky session across publishes", async () => {
        process.env.BLUESKY_HANDLE = "me.bsky.social";
        process.env.BLUESKY_APP_PASSWORD = "pw";
        let sessionCalls = 0;
        const fetchSpy = vi.fn(async (url: string) => {
            if (String(url).includes("createSession")) {
                sessionCalls++;
                return new Response(JSON.stringify({ accessJwt: "jwt", did: "did:me" }), {
                    status: 200,
                });
            }
            return new Response(JSON.stringify({ uri: "at://did:me/app.bsky.feed.post/abc" }), {
                status: 200,
            });
        });
        vi.stubGlobal("fetch", fetchSpy);

        const first = await publishToPlatform({ platform: "bluesky", message: "one" });
        const second = await publishToPlatform({ platform: "bluesky", message: "two" });

        expect(first.success).toBe(true);
        expect(first.postId).toBe("at://did:me/app.bsky.feed.post/abc");
        expect(first.postUrl).toBe("https://bsky.app/profile/me.bsky.social/post/abc");
        expect(second.success).toBe(true);
        expect(sessionCalls).toBe(1);
    });

    it("surfaces Reddit's in-body errors despite the HTTP 200", async () => {
        process.env.REDDIT_CLIENT_ID = "id";
        process.env.REDDIT_CLIENT_SECRET = "secret";
        process.env.REDDIT_USER_AGENT = "agent";
        const fetchSpy = vi.fn(async (url: string) => {
            if (String(url).includes("access_token")) {
                return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
                    status: 200,
                });
            }
            return new Response(
                JSON.stringify({ json: { errors: [["USER_REQUIRED", "please log in"]] } }),
                { status: 200 }
            );
        });
        vi.stubGlobal("fetch", fetchSpy);

        const result = await publishToPlatform({ platform: "reddit", message: "post body" });
        expect(result.success).toBe(false);
        expect(result.error).toContain("USER_REQUIRED");
    });
});
