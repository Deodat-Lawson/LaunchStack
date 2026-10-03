/**
 * The Bluesky stand-in over XRPC-shaped Requests: app-password sign-in,
 * blob upload and a post that embeds it, read-back through getPosts and
 * getPostThread (including replies created with reply refs), and the
 * session failures a client must handle.
 */
import { handleBlueskyRequest } from "~/app/dev/stand-ins/bluesky/dispatch";
import { blueskySnapshot, resetBlueskyWorld } from "~/app/dev/stand-ins/bluesky/world";
import { standInClock } from "~/app/dev/stand-ins/shared/store";

const BASE = "http://standin.test/dev/stand-ins/bluesky";
const HANDLE = "launchstack.bsky.social";
const DID = "did:plc:standinlaunchstack";
const PASSWORD = "ab12-cd34-ef56-gh78";

let now = Date.UTC(2026, 9, 11, 12, 0, 0);
const realNow = standInClock.now;

beforeEach(() => {
    now = Date.UTC(2026, 9, 11, 12, 0, 0);
    standInClock.now = () => now;
    resetBlueskyWorld();
});

afterAll(() => {
    standInClock.now = realNow;
});

const advance = (seconds: number) => {
    now += seconds * 1000;
};

function xrpc(
    method: "GET" | "POST",
    nsid: string,
    opts: {
        token?: string;
        json?: unknown;
        body?: Uint8Array<ArrayBuffer>;
        contentType?: string;
        query?: string;
    } = {}
): Promise<Response> {
    const headers: Record<string, string> = {};
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    let body: BodyInit | undefined;
    if (opts.json !== undefined) {
        headers["content-type"] = "application/json";
        body = JSON.stringify(opts.json);
    } else if (opts.body) {
        headers["content-type"] = opts.contentType ?? "application/octet-stream";
        body = opts.body;
    }
    const url = `${BASE}/xrpc/${nsid}${opts.query ? `?${opts.query}` : ""}`;
    return handleBlueskyRequest(new Request(url, { method, headers, body }));
}

async function signIn(): Promise<{ accessJwt: string; refreshJwt: string }> {
    const res = await xrpc("POST", "com.atproto.server.createSession", {
        json: { identifier: HANDLE, password: PASSWORD },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as { accessJwt: string; refreshJwt: string };
}

function postRecord(text: string, extra: Record<string, unknown> = {}) {
    return {
        $type: "app.bsky.feed.post",
        text,
        createdAt: new Date(now).toISOString(),
        langs: ["en"],
        ...extra,
    };
}

async function createPost(token: string, record: Record<string, unknown>) {
    return xrpc("POST", "com.atproto.repo.createRecord", {
        token,
        json: { repo: DID, collection: "app.bsky.feed.post", record },
    });
}

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]);

describe("createSession", () => {
    it("accepts the handle with an app-password-shaped password", async () => {
        const res = await xrpc("POST", "com.atproto.server.createSession", {
            json: { identifier: HANDLE, password: PASSWORD },
        });
        const body = (await res.json()) as Record<string, unknown>;
        expect(body).toMatchObject({ did: DID, handle: HANDLE, active: true });
        expect(String(body.accessJwt).split(".")).toHaveLength(3);
        expect(String(body.refreshJwt).split(".")).toHaveLength(3);
        expect(body.didDoc).toMatchObject({
            service: [{ id: "#atproto_pds", serviceEndpoint: BASE }],
        });
    });

    it("refuses other passwords and other accounts", async () => {
        for (const [identifier, password] of [
            [HANDLE, "my-real-password"],
            [HANDLE, "AB12-CD34-EF56-GH78"],
            ["someone.bsky.social", PASSWORD],
        ] as const) {
            const res = await xrpc("POST", "com.atproto.server.createSession", {
                json: { identifier, password },
            });
            expect(res.status).toBe(401);
            expect(await res.json()).toEqual({
                error: "AuthenticationRequired",
                message: "Invalid identifier or password",
            });
        }
    });

    it("reads the profile with the session", async () => {
        const { accessJwt } = await signIn();
        const res = await xrpc("GET", "app.bsky.actor.getProfile", {
            token: accessJwt,
            query: `actor=${HANDLE}`,
        });
        expect(res.status).toBe(200);
        const profile = (await res.json()) as Record<string, unknown>;
        expect(profile).toMatchObject({
            did: DID,
            handle: HANDLE,
            displayName: "LaunchStack",
            followersCount: 312,
        });
        expect(String(profile.avatar)).toMatch(
            /^http:\/\/standin\.test\/dev\/stand-ins\/bluesky\/img\/avatar\//
        );

        const bad = await xrpc("GET", "app.bsky.actor.getProfile", {
            token: "not-a-token",
            query: `actor=${HANDLE}`,
        });
        expect(bad.status).toBe(401);
    });
});

describe("posting", () => {
    it("uploads a blob, posts it, and reads it back with growing counts", async () => {
        const { accessJwt } = await signIn();
        const upload = await xrpc("POST", "com.atproto.repo.uploadBlob", {
            token: accessJwt,
            body: PNG,
            contentType: "image/png",
        });
        expect(upload.status).toBe(200);
        const { blob } = (await upload.json()) as {
            blob: { $type: string; ref: { $link: string }; mimeType: string; size: number };
        };
        expect(blob).toMatchObject({ $type: "blob", mimeType: "image/png", size: PNG.byteLength });
        expect(blob.ref.$link).toMatch(/^bafkrei[a-z2-7]{52}$/);

        const created = await createPost(
            accessJwt,
            postRecord("Launch day 🚀", {
                embed: {
                    $type: "app.bsky.embed.images",
                    images: [{ image: blob, alt: "The team" }],
                },
            })
        );
        expect(created.status).toBe(200);
        const ref = (await created.json()) as { uri: string; cid: string };
        expect(ref.uri).toMatch(
            /^at:\/\/did:plc:standinlaunchstack\/app\.bsky\.feed\.post\/[2-7a-z]{13}$/
        );
        expect(ref.cid).toMatch(/^bafyrei/);

        const read = async () => {
            const res = await xrpc("GET", "app.bsky.feed.getPosts", {
                query: `uris=${encodeURIComponent(ref.uri)}`,
            });
            expect(res.status).toBe(200);
            return ((await res.json()) as { posts: Record<string, unknown>[] }).posts;
        };
        const [fresh] = await read();
        expect(fresh).toMatchObject({
            uri: ref.uri,
            cid: ref.cid,
            author: { did: DID, handle: HANDLE },
            record: { text: "Launch day 🚀" },
            likeCount: 0,
            replyCount: 0,
            embed: { $type: "app.bsky.embed.images#view", images: [{ alt: "The team" }] },
        });
        const thumb = (fresh!.embed as { images: { thumb: string }[] }).images[0]!.thumb;
        const imageRes = await handleBlueskyRequest(new Request(thumb));
        expect(imageRes.headers.get("content-type")).toBe("image/png");
        expect(new Uint8Array(await imageRes.arrayBuffer())).toEqual(PNG);

        advance(30 * 60);
        const [later] = await read();
        expect(later!.likeCount).toBe(24);
        expect(later!.repostCount).toBe(4);
        // The seeded reply arrived after 30 seconds.
        expect(later!.replyCount).toBe(1);
    });

    it("validates the record like the lexicon", async () => {
        const { accessJwt } = await signIn();
        const long = await createPost(accessJwt, postRecord("x".repeat(301)));
        expect(long.status).toBe(400);
        expect(await long.json()).toEqual({
            error: "InvalidRequest",
            message:
                "Invalid app.bsky.feed.post record: Record/text must not be longer than 300 graphemes",
        });
        // 300 emoji are 300 graphemes even though they are 1200 bytes.
        expect((await createPost(accessJwt, postRecord("🙂".repeat(300)))).status).toBe(200);

        const unknownBlob = await createPost(
            accessJwt,
            postRecord("x", {
                embed: {
                    $type: "app.bsky.embed.images",
                    images: [
                        {
                            image: {
                                $type: "blob",
                                ref: { $link: "bafkreinope" },
                                mimeType: "image/png",
                                size: 3,
                            },
                            alt: "",
                        },
                    ],
                },
            })
        );
        expect(unknownBlob.status).toBe(400);
        expect(await unknownBlob.json()).toMatchObject({
            message: expect.stringContaining("Could not find blob"),
        });

        const noDate = await createPost(accessJwt, { $type: "app.bsky.feed.post", text: "x" });
        expect(noDate.status).toBe(400);
    });

    it("refuses blobs over 1,000,000 bytes and writes without a session", async () => {
        const { accessJwt } = await signIn();
        const big = await xrpc("POST", "com.atproto.repo.uploadBlob", {
            token: accessJwt,
            body: new Uint8Array(1_000_001),
            contentType: "image/png",
        });
        expect(big.status).toBe(400);
        expect(await big.json()).toMatchObject({ error: "BlobTooLarge" });

        const anonymous = await createPost("", postRecord("x"));
        expect(anonymous.status).toBe(401);
        expect(await anonymous.json()).toMatchObject({ error: "AuthMissing" });
    });
});

describe("threads", () => {
    it("returns the seeded reply and replies made with reply refs", async () => {
        const { accessJwt } = await signIn();
        const created = await createPost(accessJwt, postRecord("Hello Bluesky"));
        const root = (await created.json()) as { uri: string; cid: string };

        const thread = async (uri = root.uri) => {
            const res = await xrpc("GET", "app.bsky.feed.getPostThread", {
                query: `uri=${encodeURIComponent(uri)}&depth=6`,
            });
            expect(res.status).toBe(200);
            return (await res.json()) as {
                thread: {
                    $type: string;
                    post: { uri: string; record: { text: string } };
                    parent?: { post: { uri: string } };
                    replies?: {
                        post: {
                            uri: string;
                            cid: string;
                            author: { handle: string };
                            record: { text: string };
                        };
                        replies?: { post: { record: { text: string } } }[];
                    }[];
                };
            };
        };

        expect((await thread()).thread.replies).toEqual([]);
        advance(31);
        const withReply = (await thread()).thread;
        expect(withReply.$type).toBe("app.bsky.feed.defs#threadViewPost");
        expect(withReply.replies).toHaveLength(1);
        const fanReply = withReply.replies![0]!;
        expect(fanReply.post.author.handle).not.toBe(HANDLE);

        // Answer the fan as the account.
        const answer = await createPost(
            accessJwt,
            postRecord("Thanks!", {
                reply: {
                    root: { uri: root.uri, cid: root.cid },
                    parent: { uri: fanReply.post.uri, cid: fanReply.post.cid },
                },
            })
        );
        expect(answer.status).toBe(200);
        const answerRef = (await answer.json()) as { uri: string };

        const nested = (await thread()).thread;
        expect(nested.replies![0]!.replies!.map(r => r.post.record.text)).toEqual(["Thanks!"]);

        const fromAnswer = (await thread(answerRef.uri)).thread;
        expect(fromAnswer.parent?.post.uri).toBe(fanReply.post.uri);

        const snapshot = blueskySnapshot();
        expect(snapshot.posts).toHaveLength(1);
        expect(snapshot.posts[0]!.replies[0]!.replies[0]!.text).toBe("Thanks!");
    });

    it("answers NotFound for an unknown post", async () => {
        const res = await xrpc("GET", "app.bsky.feed.getPostThread", {
            query: `uri=${encodeURIComponent(`at://${DID}/app.bsky.feed.post/3zzzzzzzzzzzz`)}`,
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: "NotFound" });
    });
});

describe("session failures and page controls", () => {
    it("expired access → ExpiredToken; refreshSession rotates; revoked → InvalidToken", async () => {
        const session = await signIn();
        await handleBlueskyRequest(
            new Request(`${BASE}/_standin/action`, {
                method: "POST",
                body: JSON.stringify({ action: "expire-access" }),
            })
        );
        const expired = await createPost(session.accessJwt, postRecord("x"));
        expect(expired.status).toBe(400);
        expect(await expired.json()).toMatchObject({ error: "ExpiredToken" });

        const refreshed = await xrpc("POST", "com.atproto.server.refreshSession", {
            token: session.refreshJwt,
        });
        expect(refreshed.status).toBe(200);
        const next = (await refreshed.json()) as { accessJwt: string };
        expect((await createPost(next.accessJwt, postRecord("x"))).status).toBe(200);
        // A spent refresh token does not work twice.
        expect(
            (await xrpc("POST", "com.atproto.server.refreshSession", { token: session.refreshJwt }))
                .status
        ).toBe(400);

        await handleBlueskyRequest(
            new Request(`${BASE}/_standin/action`, {
                method: "POST",
                body: JSON.stringify({ action: "revoke-sessions" }),
            })
        );
        const revoked = await createPost(next.accessJwt, postRecord("x"));
        expect(revoked.status).toBe(401);
        expect(await revoked.json()).toMatchObject({ error: "InvalidToken" });
    });

    it("adds a reply from the page and resets", async () => {
        const { accessJwt } = await signIn();
        const ref = (await (await createPost(accessJwt, postRecord("Hi"))).json()) as {
            uri: string;
        };
        const res = await handleBlueskyRequest(
            new Request(`${BASE}/_standin/action`, {
                method: "POST",
                body: JSON.stringify({ action: "reply", uri: ref.uri, text: "Nice one" }),
            })
        );
        expect(res.status).toBe(200);
        const replies = blueskySnapshot().posts[0]!.replies;
        expect(replies.find(r => r.text === "Nice one")?.pending).toBe(false);

        await handleBlueskyRequest(
            new Request(`${BASE}/_standin/action`, {
                method: "POST",
                body: JSON.stringify({ action: "reset" }),
            })
        );
        expect(blueskySnapshot().posts).toEqual([]);
    });
});
