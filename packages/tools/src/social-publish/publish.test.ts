import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    publishToPlatform,
    resetBlueskySession,
    resetRedditToken,
    verifyCredentials,
} from "./index";

const ENV_KEYS = [
    "TWITTER_BEARER_TOKEN",
    "BLUESKY_HANDLE",
    "BLUESKY_APP_PASSWORD",
    "REDDIT_CLIENT_ID",
    "REDDIT_CLIENT_SECRET",
    "REDDIT_USER_AGENT",
    "LINKEDIN_ACCESS_TOKEN",
] as const;

const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};
for (const key of ENV_KEYS) savedEnv[key] = process.env[key];

function clearEnv() {
    for (const key of ENV_KEYS) delete process.env[key];
}

function restoreEnv() {
    for (const key of ENV_KEYS) {
        const value = savedEnv[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
}

interface RecordedCall {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string | null;
}

/**
 * A fetch double that records every call and answers by URL substring, so a
 * test can assert which credential reached the wire without touching the
 * global fetch.
 */
/** The adapters send JSON strings or (Reddit) URLSearchParams; nothing else needs decoding. */
function bodyToString(body: BodyInit | null | undefined): string | null {
    if (typeof body === "string") return body;
    if (body instanceof URLSearchParams) return body.toString();
    return null;
}

function fakeFetch(routes: Array<[match: string, respond: (call: RecordedCall) => Response]>) {
    const calls: RecordedCall[] = [];
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const call: RecordedCall = {
            url,
            method: init?.method ?? "GET",
            headers: Object.fromEntries(new Headers(init?.headers).entries()),
            body: bodyToString(init?.body),
        };
        calls.push(call);
        const route = routes.find(([match]) => url.includes(match));
        if (!route) return new Response("not found", { status: 404 });
        return route[1](call);
    }) as typeof fetch;
    return { impl, calls };
}

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });

const blueskyRoutes = (calls: {
    sessions: number;
}): Array<[string, (call: RecordedCall) => Response]> => [
    [
        "createSession",
        call => {
            calls.sessions++;
            const { identifier } = JSON.parse(call.body!) as { identifier: string };
            return json({
                accessJwt: `jwt-${identifier}`,
                did: `did:${identifier}`,
                handle: identifier,
            });
        },
    ],
    ["createRecord", () => json({ uri: "at://did:me/app.bsky.feed.post/abc" })],
];

describe("social-publish credentials", () => {
    beforeEach(() => {
        clearEnv();
        resetBlueskySession();
        resetRedditToken();
    });
    afterEach(restoreEnv);

    it("uses explicit credentials over the environment", async () => {
        process.env.TWITTER_BEARER_TOKEN = "env-token";
        const { impl, calls } = fakeFetch([["/2/tweets", () => json({ data: { id: "1" } }, 201)]]);

        const result = await publishToPlatform({
            platform: "x",
            message: "hello",
            credentials: { platform: "x", bearerToken: "workspace-token" },
            fetchImpl: impl,
        });

        expect(result.success).toBe(true);
        expect(result.postId).toBe("1");
        expect(calls).toHaveLength(1);
        expect(calls[0]!.headers.authorization).toBe("Bearer workspace-token");
    });

    it("falls back to the environment when credentials are absent", async () => {
        process.env.TWITTER_BEARER_TOKEN = "env-token";
        const { impl, calls } = fakeFetch([["/2/tweets", () => json({ data: { id: "2" } }, 201)]]);

        const result = await publishToPlatform({
            platform: "x",
            message: "hello",
            fetchImpl: impl,
        });

        expect(result.success).toBe(true);
        expect(calls[0]!.headers.authorization).toBe("Bearer env-token");
    });

    it("reports not-configured without a network call when neither source has a credential", async () => {
        const { impl, calls } = fakeFetch([]);

        const result = await publishToPlatform({
            platform: "linkedin",
            message: "hello",
            fetchImpl: impl,
        });

        expect(result).toMatchObject({
            success: false,
            retryable: false,
            authFailed: false,
        });
        expect(result.error).toContain("not configured");
        expect(calls).toHaveLength(0);
    });

    it("refuses credentials for a different platform instead of falling back to env", async () => {
        process.env.TWITTER_BEARER_TOKEN = "env-token";
        const { impl, calls } = fakeFetch([]);

        const result = await publishToPlatform({
            platform: "x",
            message: "hello",
            credentials: { platform: "linkedin", accessToken: "li" },
            fetchImpl: impl,
        });

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/linkedin, not x/);
        expect(calls).toHaveLength(0);
    });
});

describe("social-publish failure classification", () => {
    beforeEach(() => {
        clearEnv();
        resetBlueskySession();
        resetRedditToken();
    });
    afterEach(restoreEnv);

    it("marks a 429 as retryable", async () => {
        const { impl } = fakeFetch([
            ["/2/tweets", () => new Response("slow down", { status: 429 })],
        ]);

        const result = await publishToPlatform({
            platform: "x",
            message: "hello",
            credentials: { platform: "x", bearerToken: "t" },
            fetchImpl: impl,
        });

        expect(result).toMatchObject({
            success: false,
            status: 429,
            retryable: true,
            authFailed: false,
        });
        expect(result.error).toContain("429");
    });

    it("marks a 401 as an auth failure", async () => {
        const { impl } = fakeFetch([
            ["/2/tweets", () => new Response("unauthorized", { status: 401 })],
        ]);

        const result = await publishToPlatform({
            platform: "x",
            message: "hello",
            credentials: { platform: "x", bearerToken: "stale" },
            fetchImpl: impl,
        });

        expect(result).toMatchObject({
            success: false,
            status: 401,
            retryable: false,
            authFailed: true,
        });
    });

    it("marks a network error as retryable", async () => {
        const impl = (async () => {
            throw new TypeError("fetch failed");
        }) as unknown as typeof fetch;

        const result = await publishToPlatform({
            platform: "linkedin",
            message: "hello",
            credentials: { platform: "linkedin", accessToken: "t" },
            fetchImpl: impl,
        });

        expect(result).toMatchObject({ success: false, retryable: true, authFailed: false });
        expect(result.status).toBeUndefined();
    });

    it("treats a rejected Bluesky session as an auth failure", async () => {
        const { impl } = fakeFetch([
            [
                "createSession",
                () => json({ error: "AuthenticationRequired", message: "Invalid password" }, 401),
            ],
        ]);

        const result = await publishToPlatform({
            platform: "bluesky",
            message: "hello",
            credentials: { platform: "bluesky", handle: "me.bsky.social", appPassword: "bad" },
            fetchImpl: impl,
        });

        expect(result).toMatchObject({
            success: false,
            status: 401,
            retryable: false,
            authFailed: true,
        });
        expect(result.error).toContain("Bluesky auth failed");
    });

    it("marks Reddit's in-body USER_REQUIRED as an auth failure despite the HTTP 200", async () => {
        const { impl } = fakeFetch([
            ["access_token", () => json({ access_token: "tok", expires_in: 3600 })],
            ["/api/submit", () => json({ json: { errors: [["USER_REQUIRED", "please log in"]] } })],
        ]);

        const result = await publishToPlatform({
            platform: "reddit",
            message: "post body",
            credentials: {
                platform: "reddit",
                clientId: "id",
                clientSecret: "secret",
                userAgent: "agent",
            },
            fetchImpl: impl,
        });

        expect(result).toMatchObject({
            success: false,
            status: 200,
            retryable: false,
            authFailed: true,
        });
        expect(result.error).toContain("USER_REQUIRED");
    });
});

describe("verifyCredentials", () => {
    beforeEach(() => {
        clearEnv();
        resetBlueskySession();
        resetRedditToken();
    });
    afterEach(restoreEnv);

    it("succeeds for Bluesky and names the handle", async () => {
        const counter = { sessions: 0 };
        const { impl, calls } = fakeFetch(blueskyRoutes(counter));

        const result = await verifyCredentials(
            { platform: "bluesky", handle: "me.bsky.social", appPassword: "pw" },
            { fetchImpl: impl }
        );

        expect(result).toEqual({ ok: true, identity: "me.bsky.social" });
        expect(calls).toHaveLength(1);
        expect(calls[0]!.url).toContain("createSession");
    });

    it("fails with authFailed for LinkedIn on 401", async () => {
        const { impl, calls } = fakeFetch([
            ["/v2/userinfo", () => new Response("expired", { status: 401 })],
        ]);

        const result = await verifyCredentials(
            { platform: "linkedin", accessToken: "expired" },
            { fetchImpl: impl }
        );

        expect(result.ok).toBe(false);
        expect(result).toMatchObject({ authFailed: true, retryable: false });
        expect(calls).toHaveLength(1);
        expect(calls[0]!.headers.authorization).toBe("Bearer expired");
    });

    it("names the LinkedIn member on success", async () => {
        const { impl } = fakeFetch([
            ["/v2/userinfo", () => json({ sub: "abc123", name: "Ada Lovelace" })],
        ]);

        const result = await verifyCredentials(
            { platform: "linkedin", accessToken: "good" },
            { fetchImpl: impl }
        );

        expect(result).toEqual({ ok: true, identity: "Ada Lovelace" });
    });

    it("names the X account and rejects an app-only token as an auth failure", async () => {
        const user = fakeFetch([
            ["/2/users/me", () => json({ data: { username: "launchstack" } })],
        ]);
        expect(
            await verifyCredentials(
                { platform: "x", bearerToken: "user" },
                { fetchImpl: user.impl }
            )
        ).toEqual({ ok: true, identity: "@launchstack" });

        const appOnly = fakeFetch([
            ["/2/users/me", () => new Response("forbidden", { status: 403 })],
        ]);
        const result = await verifyCredentials(
            { platform: "x", bearerToken: "app-only" },
            { fetchImpl: appOnly.impl }
        );
        expect(result.ok).toBe(false);
        expect(result).toMatchObject({ authFailed: true, retryable: false });
        if (!result.ok) expect(result.error).toMatch(/user context/i);
    });

    it("succeeds for Reddit with no identity", async () => {
        const { impl } = fakeFetch([
            ["access_token", () => json({ access_token: "tok", expires_in: 3600 })],
        ]);

        const result = await verifyCredentials(
            { platform: "reddit", clientId: "id", clientSecret: "secret", userAgent: "agent" },
            { fetchImpl: impl }
        );

        expect(result).toEqual({ ok: true, identity: null });
    });
});

describe("per-credential caches", () => {
    beforeEach(() => {
        clearEnv();
        resetBlueskySession();
        resetRedditToken();
    });
    afterEach(restoreEnv);

    it("keeps one Bluesky session per handle", async () => {
        const counter = { sessions: 0 };
        const { impl, calls } = fakeFetch(blueskyRoutes(counter));
        const alice = {
            platform: "bluesky",
            handle: "alice.bsky.social",
            appPassword: "a",
        } as const;
        const bob = { platform: "bluesky", handle: "bob.bsky.social", appPassword: "b" } as const;

        const first = await publishToPlatform({
            platform: "bluesky",
            message: "one",
            credentials: alice,
            fetchImpl: impl,
        });
        const second = await publishToPlatform({
            platform: "bluesky",
            message: "two",
            credentials: bob,
            fetchImpl: impl,
        });
        const third = await publishToPlatform({
            platform: "bluesky",
            message: "three",
            credentials: alice,
            fetchImpl: impl,
        });

        expect([first.success, second.success, third.success]).toEqual([true, true, true]);
        expect(counter.sessions).toBe(2);
        expect(first.postUrl).toBe("https://bsky.app/profile/alice.bsky.social/post/abc");
        expect(second.postUrl).toBe("https://bsky.app/profile/bob.bsky.social/post/abc");

        // Each workspace's posts go out under its own JWT.
        const records = calls.filter(call => call.url.includes("createRecord"));
        expect(records.map(call => call.headers.authorization)).toEqual([
            "Bearer jwt-alice.bsky.social",
            "Bearer jwt-bob.bsky.social",
            "Bearer jwt-alice.bsky.social",
        ]);
    });

    it("keeps one Reddit app token per client id", async () => {
        let tokenCalls = 0;
        const { impl, calls } = fakeFetch([
            [
                "access_token",
                call => {
                    tokenCalls++;
                    return json({
                        access_token: `tok-${call.headers.authorization}`,
                        expires_in: 3600,
                    });
                },
            ],
            ["/api/submit", () => json({ json: { errors: [], data: { name: "t3_x", url: "u" } } })],
        ]);
        const creds = (clientId: string) =>
            ({ platform: "reddit", clientId, clientSecret: "s", userAgent: "ua" }) as const;

        await publishToPlatform({
            platform: "reddit",
            message: "a",
            credentials: creds("one"),
            fetchImpl: impl,
        });
        await publishToPlatform({
            platform: "reddit",
            message: "b",
            credentials: creds("two"),
            fetchImpl: impl,
        });
        await publishToPlatform({
            platform: "reddit",
            message: "c",
            credentials: creds("one"),
            fetchImpl: impl,
        });

        expect(tokenCalls).toBe(2);
        const submits = calls.filter(call => call.url.includes("/api/submit"));
        expect(submits).toHaveLength(3);
        expect(submits[0]!.headers.authorization).toBe(submits[2]!.headers.authorization);
        expect(submits[0]!.headers.authorization).not.toBe(submits[1]!.headers.authorization);
    });
});
