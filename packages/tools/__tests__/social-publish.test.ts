import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    publishToPlatform,
    resetBlueskySession,
    resetRedditToken,
} from "@launchstack/tools/social-publish";

const savedEnv = { ...process.env };

/** Endpoint overrides a developer's shell may carry; tests run against the defaults. */
const ENDPOINT_KEYS = [
    "LINKEDIN_API_VERSION",
    "LINKEDIN_API_BASE_URL",
    "BLUESKY_SERVICE_URL",
    "BLUESKY_APPVIEW_URL",
];

function restoreEnv() {
    for (const key of [
        "TWITTER_BEARER_TOKEN",
        "BLUESKY_HANDLE",
        "BLUESKY_APP_PASSWORD",
        "REDDIT_CLIENT_ID",
        "REDDIT_CLIENT_SECRET",
        "REDDIT_USER_AGENT",
        "LINKEDIN_ACCESS_TOKEN",
        ...ENDPOINT_KEYS,
    ]) {
        const value = savedEnv[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
}

describe("social-publish", () => {
    beforeEach(() => {
        for (const key of ENDPOINT_KEYS) delete process.env[key];
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

    describe("publish targets", () => {
        interface Call {
            url: string;
            method: string;
            headers: Record<string, string>;
            body: unknown;
        }

        /** Stub the global fetch: answer by URL substring, record every call. */
        function stubFetch(routes: Array<[string, (url: string) => Response]>) {
            const calls: Call[] = [];
            const spy = vi.fn(async (url: string, init: RequestInit = {}) => {
                calls.push({
                    url,
                    method: init.method ?? "GET",
                    headers: (init.headers ?? {}) as Record<string, string>,
                    body: init.body,
                });
                const route = routes.find(([match]) => url.includes(match));
                if (!route) throw new Error(`unexpected fetch: ${url}`);
                return route[1](url);
            });
            vi.stubGlobal("fetch", spy);
            return { spy, calls };
        }

        const json = (body: unknown, status = 200) =>
            new Response(JSON.stringify(body), { status });
        const image = { data: new Uint8Array([1, 2, 3]), mimeType: "image/png", alt: "Chart" };

        it("LinkedIn: posts as the target's author with its token, images first, no member lookup", async () => {
            process.env.LINKEDIN_ACCESS_TOKEN = "env-token";
            const { calls } = stubFetch([
                [
                    "initializeUpload",
                    () =>
                        json({
                            value: {
                                uploadUrl: "https://upload.li.test/1",
                                image: "urn:li:image:A",
                            },
                        }),
                ],
                ["https://upload.li.test/", () => new Response(null, { status: 201 })],
                [
                    "/rest/posts",
                    () =>
                        new Response(null, {
                            status: 201,
                            headers: { "x-restli-id": "urn:li:share:77" },
                        }),
                ],
            ]);

            const result = await publishToPlatform({
                platform: "linkedin",
                message: "Hello from the Page",
                target: {
                    kind: "linkedin",
                    accessToken: "page-token",
                    authorUrn: "urn:li:organization:5",
                },
                media: [image],
            });

            expect(result).toEqual({
                success: true,
                platform: "linkedin",
                postId: "urn:li:share:77",
                postUrl: "https://www.linkedin.com/feed/update/urn:li:share:77",
            });
            expect(calls.map(c => c.url)).toEqual([
                "https://api.linkedin.com/rest/images?action=initializeUpload",
                "https://upload.li.test/1",
                "https://api.linkedin.com/rest/posts",
            ]);
            expect(calls.every(c => c.headers.Authorization === "Bearer page-token")).toBe(true);
            const post = JSON.parse(String(calls[2]!.body)) as Record<string, unknown>;
            expect(post.author).toBe("urn:li:organization:5");
            expect(post.content).toEqual({ media: { id: "urn:li:image:A", altText: "Chart" } });
        });

        it("LinkedIn: without a target, the env token posts as its member", async () => {
            process.env.LINKEDIN_ACCESS_TOKEN = "env-token";
            const { calls } = stubFetch([
                ["/v2/userinfo", () => json({ sub: "m1", name: "Op" })],
                [
                    "/rest/posts",
                    () =>
                        new Response(null, {
                            status: 201,
                            headers: { "x-restli-id": "urn:li:share:1" },
                        }),
                ],
            ]);

            const result = await publishToPlatform({ platform: "linkedin", message: "hi" });

            expect(result.success).toBe(true);
            expect(calls[0]!.url).toBe("https://api.linkedin.com/v2/userinfo");
            expect(calls[1]!.headers.Authorization).toBe("Bearer env-token");
            expect(calls[1]!.headers["LinkedIn-Version"]).toBe("202609");
            expect(JSON.parse(String(calls[1]!.body)).author).toBe("urn:li:person:m1");
        });

        it("LinkedIn: maps a refused token, a rate limit and a retired version", async () => {
            const target = {
                kind: "linkedin" as const,
                accessToken: "t",
                authorUrn: "urn:li:person:p",
            };

            stubFetch([["/rest/posts", () => json({ message: "Invalid access token" }, 401)]]);
            const refused = await publishToPlatform({ platform: "linkedin", message: "x", target });
            expect(refused).toMatchObject({ success: false, authFailed: true });
            expect(refused.retryable).toBeUndefined();

            stubFetch([["/rest/posts", () => json({ message: "Throttled" }, 429)]]);
            const limited = await publishToPlatform({ platform: "linkedin", message: "x", target });
            expect(limited).toMatchObject({ success: false, retryable: true });
            expect(limited.authFailed).toBeUndefined();

            stubFetch([
                [
                    "/rest/posts",
                    () =>
                        json(
                            {
                                code: "NONEXISTENT_VERSION",
                                message: "Requested version 202609 is not active",
                            },
                            426
                        ),
                ],
            ]);
            const retired = await publishToPlatform({ platform: "linkedin", message: "x", target });
            expect(retired.success).toBe(false);
            expect(retired.error).toContain("Set LINKEDIN_API_VERSION");
        });

        it("LinkedIn: an env member lookup refused as 401 is authFailed", async () => {
            process.env.LINKEDIN_ACCESS_TOKEN = "env-token";
            stubFetch([
                ["/v2/userinfo", () => json({ message: "Invalid access token" }, 401)],
                ["/v2/me", () => json({ message: "Invalid access token" }, 401)],
            ]);
            const result = await publishToPlatform({ platform: "linkedin", message: "x" });
            expect(result).toMatchObject({ success: false, authFailed: true });
            expect(result.error).toContain("LinkedIn author lookup failed");
        });

        it("refuses a target for another network without touching the network", async () => {
            const { spy } = stubFetch([]);
            const result = await publishToPlatform({
                platform: "linkedin",
                message: "x",
                target: { kind: "bluesky", identifier: "a.bsky.social", appPassword: "p" },
            });
            expect(result.success).toBe(false);
            expect(result.error).toContain("cannot publish to LinkedIn");
            expect(spy).not.toHaveBeenCalled();
        });

        it("Bluesky: posts as the target account on its own PDS, with images", async () => {
            process.env.BLUESKY_HANDLE = "env.bsky.social";
            process.env.BLUESKY_APP_PASSWORD = "env-pw";
            const { calls } = stubFetch([
                [
                    "createSession",
                    () =>
                        json({ accessJwt: "jwt", did: "did:plc:team", handle: "team.example.com" }),
                ],
                ["uploadBlob", () => json({ blob: { $type: "blob", ref: { $link: "b" } } })],
                [
                    "createRecord",
                    () => json({ uri: "at://did:plc:team/app.bsky.feed.post/3k", cid: "c" }),
                ],
            ]);

            const result = await publishToPlatform({
                platform: "bluesky",
                message: "Team update",
                target: {
                    kind: "bluesky",
                    identifier: "team.example.com",
                    appPassword: "team-pw",
                    service: "https://pds.example.com",
                },
                media: [image],
            });

            expect(result).toEqual({
                success: true,
                platform: "bluesky",
                postId: "at://did:plc:team/app.bsky.feed.post/3k",
                postUrl: "https://bsky.app/profile/team.example.com/post/3k",
            });
            expect(calls.map(c => c.url)).toEqual([
                "https://pds.example.com/xrpc/com.atproto.server.createSession",
                "https://pds.example.com/xrpc/com.atproto.repo.uploadBlob",
                "https://pds.example.com/xrpc/com.atproto.repo.createRecord",
            ]);
            expect(JSON.parse(String(calls[0]!.body))).toEqual({
                identifier: "team.example.com",
                password: "team-pw",
            });
            const record = JSON.parse(String(calls[2]!.body)).record as Record<string, unknown>;
            expect(record.embed).toMatchObject({
                $type: "app.bsky.embed.images",
                images: [{ alt: "Chart" }],
            });
        });

        it("Bluesky: without a target, the env account posts through bsky.social", async () => {
            process.env.BLUESKY_HANDLE = "env.bsky.social";
            process.env.BLUESKY_APP_PASSWORD = "env-pw";
            const { calls } = stubFetch([
                ["createSession", () => json({ accessJwt: "jwt", did: "did:plc:env" })],
                [
                    "createRecord",
                    () => json({ uri: "at://did:plc:env/app.bsky.feed.post/9", cid: "c" }),
                ],
            ]);

            const result = await publishToPlatform({ platform: "bluesky", message: "hi" });

            expect(result.postUrl).toBe("https://bsky.app/profile/env.bsky.social/post/9");
            expect(calls[0]!.url).toBe("https://bsky.social/xrpc/com.atproto.server.createSession");
            expect(JSON.parse(String(calls[0]!.body)).identifier).toBe("env.bsky.social");
        });

        it("Bluesky: a refused app password is authFailed; an outage is retryable", async () => {
            const target = {
                kind: "bluesky" as const,
                identifier: "team.example.com",
                appPassword: "revoked",
            };

            stubFetch([["createSession", () => json({ error: "AuthenticationRequired" }, 401)]]);
            const refused = await publishToPlatform({ platform: "bluesky", message: "x", target });
            expect(refused).toMatchObject({
                success: false,
                authFailed: true,
                error: "Bluesky refused that handle and app password",
            });

            stubFetch([["createSession", () => new Response("upstream down", { status: 503 })]]);
            const down = await publishToPlatform({ platform: "bluesky", message: "x", target });
            expect(down).toMatchObject({ success: false, retryable: true });
        });

        it("Bluesky: an over-long post fails clearly instead of being cut", async () => {
            process.env.BLUESKY_HANDLE = "env.bsky.social";
            process.env.BLUESKY_APP_PASSWORD = "env-pw";
            const { spy } = stubFetch([]);
            const result = await publishToPlatform({
                platform: "bluesky",
                message: "y".repeat(301),
            });
            expect(result.success).toBe(false);
            expect(result.error).toContain("limited to 300 characters");
            expect(spy).not.toHaveBeenCalled();
        });
    });
});
