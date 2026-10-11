import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    BlueskyApiError,
    createBlueskyPost,
    detectFacets,
    getBlueskyPostStats,
    getBlueskyProfile,
    graphemeLength,
    listBlueskyReplies,
    resetBlueskySessions,
    verifyBlueskyCredentials,
} from "@launchstack/tools/social-publish/bluesky";
import { imageDimensions } from "../src/social-publish/bluesky/richtext";

const PDS = "https://pds.test";
const APPVIEW = "https://appview.test";
const CREDS = { identifier: "acme.bsky.social", appPassword: "abcd-efgh-ijkl-mnop", service: PDS };

interface Call {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: unknown;
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function router(routes: Array<[string, Handler]>) {
    const calls: Call[] = [];
    const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push({
            url,
            method: init.method ?? "GET",
            headers: (init.headers ?? {}) as Record<string, string>,
            body: init.body,
        });
        for (const [match, handler] of routes) {
            if (url.includes(match)) return handler(url, init);
        }
        throw new Error(`unexpected fetch: ${init.method ?? "GET"} ${url}`);
    });
    return { fetch, calls };
}

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });

const bodyOf = (call: Call | undefined) =>
    JSON.parse(String(call?.body)) as Record<string, unknown>;

const session =
    (n = 1) =>
    () =>
        json({
            accessJwt: `jwt-${n}`,
            refreshJwt: "r",
            did: "did:plc:acme",
            handle: "acme.bsky.social",
        });

/** A PNG header claiming 1200×630. */
function pngHeader(): Uint8Array {
    const bytes = new Uint8Array(33);
    bytes.set([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
    ]);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, 1200);
    view.setUint32(20, 630);
    return bytes;
}

const blob = (n: number) => ({
    $type: "blob",
    ref: { $link: `bafkrei${n}` },
    mimeType: "image/png",
    size: 33,
});

beforeEach(() => resetBlueskySessions());
afterEach(() => resetBlueskySessions());

describe("verifyBlueskyCredentials", () => {
    it("signs in, then reads the profile with the new session", async () => {
        const { fetch, calls } = router([
            ["com.atproto.server.createSession", session()],
            [
                "app.bsky.actor.getProfile",
                () =>
                    json({
                        did: "did:plc:acme",
                        handle: "acme.bsky.social",
                        displayName: "Acme Inc",
                        avatar: "https://cdn.test/avatar.jpg",
                        followersCount: 812,
                    }),
            ],
        ]);

        const profile = await verifyBlueskyCredentials(
            { ...CREDS, identifier: "@acme.bsky.social", service: `${PDS}/` },
            { fetch }
        );

        expect(profile).toEqual({
            did: "did:plc:acme",
            handle: "acme.bsky.social",
            displayName: "Acme Inc",
            avatarUrl: "https://cdn.test/avatar.jpg",
            followers: 812,
        });
        expect(calls[0]!.url).toBe(`${PDS}/xrpc/com.atproto.server.createSession`);
        expect(calls[0]!.method).toBe("POST");
        expect(bodyOf(calls[0])).toEqual({
            identifier: "acme.bsky.social",
            password: CREDS.appPassword,
        });
        expect(calls[1]!.url).toBe(`${PDS}/xrpc/app.bsky.actor.getProfile?actor=did%3Aplc%3Aacme`);
        expect(calls[1]!.headers.Authorization).toBe("Bearer jwt-1");
    });

    it("a refused password is authFailed with a plain message", async () => {
        const { fetch } = router([
            [
                "createSession",
                () =>
                    json(
                        {
                            error: "AuthenticationRequired",
                            message: "Invalid identifier or password",
                        },
                        401
                    ),
            ],
        ]);
        const err = (await verifyBlueskyCredentials(CREDS, { fetch }).catch(
            e => e
        )) as BlueskyApiError;
        expect(err).toBeInstanceOf(BlueskyApiError);
        expect(err).toMatchObject({ status: 401, authFailed: true, retryable: false });
        expect(err.message).toBe("Bluesky refused that handle and app password");
    });

    it("rate limits and outages are retryable", async () => {
        const limited = router([
            ["createSession", () => json({ error: "RateLimitExceeded" }, 429)],
        ]);
        await expect(
            verifyBlueskyCredentials(CREDS, { fetch: limited.fetch })
        ).rejects.toMatchObject({
            authFailed: false,
            retryable: true,
        });
        const offline = router([
            [
                "createSession",
                () => {
                    throw new TypeError("fetch failed");
                },
            ],
        ]);
        await expect(
            verifyBlueskyCredentials(CREDS, { fetch: offline.fetch })
        ).rejects.toMatchObject({
            status: 0,
            retryable: true,
        });
    });
});

describe("getBlueskyProfile", () => {
    it("reads the public AppView without signing in", async () => {
        const { fetch, calls } = router([
            [
                "app.bsky.actor.getProfile",
                () => json({ did: "did:plc:acme", handle: "acme.bsky.social", followersCount: 9 }),
            ],
        ]);
        const profile = await getBlueskyProfile("acme.bsky.social", { fetch, appViewUrl: APPVIEW });
        expect(profile).toEqual({
            did: "did:plc:acme",
            handle: "acme.bsky.social",
            displayName: null,
            avatarUrl: null,
            followers: 9,
        });
        expect(calls[0]!.url).toBe(
            `${APPVIEW}/xrpc/app.bsky.actor.getProfile?actor=acme.bsky.social`
        );
        expect(calls[0]!.headers.Authorization).toBeUndefined();
    });
});

describe("rich text", () => {
    it("counts graphemes, not code units", () => {
        expect(graphemeLength("👨‍👩‍👧 é")).toBe(3);
    });

    it("puts link and tag facets at UTF-8 byte offsets", () => {
        const text = "Café 😀 launch: https://example.com/a. #ship it";
        const facets = detectFacets(text);
        expect(facets).toEqual([
            {
                index: { byteStart: 19, byteEnd: 40 },
                features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://example.com/a" }],
            },
            {
                index: { byteStart: 42, byteEnd: 47 },
                features: [{ $type: "app.bsky.richtext.facet#tag", tag: "ship" }],
            },
        ]);
        const bytes = new TextEncoder().encode(text);
        const decode = (s: number, e: number) => new TextDecoder().decode(bytes.slice(s, e));
        expect(decode(19, 40)).toBe("https://example.com/a");
        expect(decode(42, 47)).toBe("#ship");
    });

    it("keeps a URL's own brackets and drops the sentence's", () => {
        const facets = detectFacets(
            "(see https://en.wikipedia.org/wiki/Rust_(language)) and #2024"
        );
        expect(facets).toHaveLength(1);
        expect(facets[0]!.features[0]).toEqual({
            $type: "app.bsky.richtext.facet#link",
            uri: "https://en.wikipedia.org/wiki/Rust_(language)",
        });
    });

    it("reads image sizes from PNG, GIF, JPEG and WebP headers", () => {
        expect(imageDimensions(pngHeader())).toEqual({ width: 1200, height: 630 });
        expect(
            imageDimensions(
                new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xf0, 0x00])
            )
        ).toEqual({ width: 320, height: 240 });
        const jpeg = new Uint8Array([
            0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01,
            0xe0, 0x02, 0x80, 0x03, 0x00, 0x00, 0x00, 0x00,
        ]);
        expect(imageDimensions(jpeg)).toEqual({ width: 640, height: 480 });
        const webp = new Uint8Array(30);
        webp.set([...new TextEncoder().encode("RIFF")], 0);
        webp.set([...new TextEncoder().encode("WEBPVP8X")], 8);
        webp.set([0x7f, 0x07, 0x00, 0x37, 0x04, 0x00], 24); // 1920 × 1080, stored minus one
        expect(imageDimensions(webp)).toEqual({ width: 1920, height: 1080 });
        expect(imageDimensions(new Uint8Array([1, 2, 3]))).toBeNull();
    });
});

describe("createBlueskyPost", () => {
    it("uploads images as blobs and posts text, facets and the image embed", async () => {
        const image = pngHeader();
        const { fetch, calls } = router([
            ["createSession", session()],
            ["com.atproto.repo.uploadBlob", () => json({ blob: blob(1) })],
            [
                "com.atproto.repo.createRecord",
                () =>
                    json({
                        uri: "at://did:plc:acme/app.bsky.feed.post/3kabc",
                        cid: "bafyrei-post",
                    }),
            ],
        ]);

        const text = "Café 😀 launch: https://example.com/a. #ship it";
        const result = await createBlueskyPost(
            CREDS,
            {
                text,
                media: [{ data: image, mimeType: "image/png", alt: "Launch banner" }],
                langs: ["en"],
            },
            { fetch }
        );

        expect(result).toEqual({
            uri: "at://did:plc:acme/app.bsky.feed.post/3kabc",
            cid: "bafyrei-post",
            url: "https://bsky.app/profile/acme.bsky.social/post/3kabc",
        });
        expect(calls.map(c => c.url.replace(PDS, ""))).toEqual([
            "/xrpc/com.atproto.server.createSession",
            "/xrpc/com.atproto.repo.uploadBlob",
            "/xrpc/com.atproto.repo.createRecord",
        ]);
        const upload = calls[1]!;
        expect(upload.headers).toMatchObject({
            Authorization: "Bearer jwt-1",
            "Content-Type": "image/png",
        });
        expect(upload.body).toBe(image);

        const sent = bodyOf(calls[2]);
        expect(calls[2]!.headers.Authorization).toBe("Bearer jwt-1");
        expect(sent.repo).toBe("did:plc:acme");
        expect(sent.collection).toBe("app.bsky.feed.post");
        const record = sent.record as Record<string, unknown>;
        expect(record).toMatchObject({
            $type: "app.bsky.feed.post",
            text,
            langs: ["en"],
            facets: detectFacets(text),
            embed: {
                $type: "app.bsky.embed.images",
                images: [
                    {
                        image: blob(1),
                        alt: "Launch banner",
                        aspectRatio: { width: 1200, height: 630 },
                    },
                ],
            },
        });
        expect(Number.isNaN(Date.parse(String(record.createdAt)))).toBe(false);
        expect(record.reply).toBeUndefined();
    });

    it("carries reply refs", async () => {
        const { fetch, calls } = router([
            ["createSession", session()],
            [
                "createRecord",
                () => json({ uri: "at://did:plc:acme/app.bsky.feed.post/r1", cid: "c" }),
            ],
        ]);
        const root = { uri: "at://did:plc:x/app.bsky.feed.post/root", cid: "cid-root" };
        const parent = { uri: "at://did:plc:y/app.bsky.feed.post/parent", cid: "cid-parent" };

        await createBlueskyPost(CREDS, { text: "Thanks!", reply: { root, parent } }, { fetch });

        const record = bodyOf(calls[1]).record as Record<string, unknown>;
        expect(record.reply).toEqual({ root, parent });
        expect(record.facets).toBeUndefined();
        expect(record.embed).toBeUndefined();
    });

    it("refuses over-long text and oversized or surplus images before any network call", async () => {
        const { fetch } = router([]);
        await expect(
            createBlueskyPost(CREDS, { text: "é".repeat(301) }, { fetch })
        ).rejects.toThrow("limited to 300 characters; this one has 301");

        const big = {
            data: new Uint8Array(1_000_001),
            mimeType: "image/jpeg",
            filename: "big.jpg",
        };
        await expect(
            createBlueskyPost(CREDS, { text: "x", media: [big] }, { fetch })
        ).rejects.toThrow("Bluesky takes images up to 1 MB; big.jpg is 1.0 MB.");

        const small = { data: new Uint8Array(10), mimeType: "image/png" };
        await expect(
            createBlueskyPost(
                CREDS,
                { text: "x", media: [small, small, small, small, small] },
                { fetch }
            )
        ).rejects.toThrow("at most 4 images");

        await expect(
            createBlueskyPost(
                CREDS,
                { text: "x", media: [{ data: new Uint8Array(1), mimeType: "image/bmp" }] },
                { fetch }
            )
        ).rejects.toMatchObject({ authFailed: false, retryable: false });

        expect(fetch).not.toHaveBeenCalled();
    });

    it("300 multi-byte characters are within the limit", async () => {
        const { fetch } = router([
            ["createSession", session()],
            [
                "createRecord",
                () => json({ uri: "at://did:plc:acme/app.bsky.feed.post/ok", cid: "c" }),
            ],
        ]);
        await expect(
            createBlueskyPost(CREDS, { text: "é".repeat(300) }, { fetch })
        ).resolves.toMatchObject({ uri: "at://did:plc:acme/app.bsky.feed.post/ok" });
    });

    it("reuses the session, and signs in again once when the cached one has expired", async () => {
        let sessions = 0;
        let records = 0;
        const { fetch } = router([
            ["createSession", () => session(++sessions)()],
            [
                "createRecord",
                (_url, init) => {
                    records++;
                    const auth = (init.headers as Record<string, string>).Authorization;
                    if (records === 3 && auth === "Bearer jwt-1") {
                        return json({ error: "ExpiredToken", message: "Token has expired" }, 400);
                    }
                    return json({
                        uri: `at://did:plc:acme/app.bsky.feed.post/p${records}`,
                        cid: "c",
                    });
                },
            ],
        ]);

        await createBlueskyPost(CREDS, { text: "one" }, { fetch });
        await createBlueskyPost(CREDS, { text: "two" }, { fetch });
        expect(sessions).toBe(1);

        const third = await createBlueskyPost(CREDS, { text: "three" }, { fetch });
        expect(sessions).toBe(2);
        expect(third.uri).toBe("at://did:plc:acme/app.bsky.feed.post/p4");
    });

    it("a revoked app password is authFailed", async () => {
        const { fetch } = router([
            ["createSession", () => json({ error: "AuthenticationRequired" }, 401)],
        ]);
        await expect(createBlueskyPost(CREDS, { text: "hi" }, { fetch })).rejects.toMatchObject({
            authFailed: true,
            message: "Bluesky refused that handle and app password",
        });
    });
});

describe("getBlueskyPostStats", () => {
    it("asks the AppView for up to 25 posts per call and maps the counts", async () => {
        const uris = Array.from(
            { length: 30 },
            (_, i) => `at://did:plc:acme/app.bsky.feed.post/p${i}`
        );
        const { fetch, calls } = router([
            [
                "app.bsky.feed.getPosts",
                url => {
                    const asked = new URL(url).searchParams.getAll("uris");
                    return json({
                        posts: asked.map((uri, i) => ({
                            uri,
                            cid: `c${i}`,
                            likeCount: i,
                            repostCount: 2,
                            replyCount: 3,
                            quoteCount: 4,
                        })),
                    });
                },
            ],
        ]);

        const stats = await getBlueskyPostStats(uris, { fetch, appViewUrl: APPVIEW });

        expect(calls).toHaveLength(2);
        expect(new URL(calls[0]!.url).searchParams.getAll("uris")).toHaveLength(25);
        expect(new URL(calls[1]!.url).searchParams.getAll("uris")).toHaveLength(5);
        expect(calls[0]!.url).toContain(
            `${APPVIEW}/xrpc/app.bsky.feed.getPosts?uris=at%3A%2F%2Fdid%3Aplc%3Aacme%2Fapp.bsky.feed.post%2Fp0&uris=`
        );
        expect(calls[0]!.headers.Authorization).toBeUndefined();
        expect(stats.size).toBe(30);
        expect(stats.get(uris[1]!)).toEqual({
            uri: uris[1],
            likes: 1,
            reposts: 2,
            replies: 3,
            quotes: 4,
        });
    });
});

describe("listBlueskyReplies", () => {
    const ROOT = "at://did:plc:acme/app.bsky.feed.post/root";
    const author = (n: string) => ({
        did: `did:plc:${n}`,
        handle: `${n}.bsky.social`,
        displayName: n.toUpperCase(),
    });

    it("walks nested replies, skipping deleted ones, newest first", async () => {
        const { fetch, calls } = router([
            [
                "app.bsky.feed.getPostThread",
                () =>
                    json({
                        thread: {
                            $type: "app.bsky.feed.defs#threadViewPost",
                            post: {
                                uri: ROOT,
                                cid: "cid-root",
                                author: author("acme"),
                                record: { text: "Launch" },
                            },
                            replies: [
                                {
                                    $type: "app.bsky.feed.defs#threadViewPost",
                                    post: {
                                        uri: "at://did:plc:bob/app.bsky.feed.post/r1",
                                        cid: "cid-r1",
                                        author: author("bob"),
                                        record: {
                                            text: "Congrats",
                                            createdAt: "2026-10-01T10:00:00.000Z",
                                            reply: {
                                                root: { uri: ROOT, cid: "cid-root" },
                                                parent: { uri: ROOT, cid: "cid-root" },
                                            },
                                        },
                                    },
                                    replies: [
                                        {
                                            $type: "app.bsky.feed.defs#threadViewPost",
                                            post: {
                                                uri: "at://did:plc:acme/app.bsky.feed.post/r2",
                                                cid: "cid-r2",
                                                author: {
                                                    did: "did:plc:acme",
                                                    handle: "acme.bsky.social",
                                                    displayName: "",
                                                },
                                                record: {
                                                    text: "Thank you!",
                                                    createdAt: "2026-10-01T11:00:00.000Z",
                                                    reply: {
                                                        root: { uri: ROOT, cid: "cid-root" },
                                                        parent: {
                                                            uri: "at://did:plc:bob/app.bsky.feed.post/r1",
                                                            cid: "cid-r1",
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    ],
                                },
                                {
                                    $type: "app.bsky.feed.defs#notFoundPost",
                                    uri: "at://gone",
                                    notFound: true,
                                },
                            ],
                        },
                    }),
            ],
        ]);

        const replies = await listBlueskyReplies(ROOT, { fetch, appViewUrl: APPVIEW });

        expect(calls[0]!.url).toBe(
            `${APPVIEW}/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(ROOT)}&depth=6`
        );
        expect(replies).toEqual([
            {
                uri: "at://did:plc:acme/app.bsky.feed.post/r2",
                cid: "cid-r2",
                parent: { uri: "at://did:plc:bob/app.bsky.feed.post/r1", cid: "cid-r1" },
                root: { uri: ROOT, cid: "cid-root" },
                authorDid: "did:plc:acme",
                authorHandle: "acme.bsky.social",
                authorName: null,
                text: "Thank you!",
                createdAt: new Date("2026-10-01T11:00:00.000Z"),
            },
            {
                uri: "at://did:plc:bob/app.bsky.feed.post/r1",
                cid: "cid-r1",
                parent: { uri: ROOT, cid: "cid-root" },
                root: { uri: ROOT, cid: "cid-root" },
                authorDid: "did:plc:bob",
                authorHandle: "bob.bsky.social",
                authorName: "BOB",
                text: "Congrats",
                createdAt: new Date("2026-10-01T10:00:00.000Z"),
            },
        ]);
    });

    it("a deleted post has no replies", async () => {
        const { fetch } = router([
            [
                "getPostThread",
                () => json({ error: "NotFound", message: "Post not found: at://x" }, 400),
            ],
        ]);
        await expect(listBlueskyReplies(ROOT, { fetch, appViewUrl: APPVIEW })).resolves.toEqual([]);
    });
});
