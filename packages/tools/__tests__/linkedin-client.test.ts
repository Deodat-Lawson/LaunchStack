import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createLinkedInComment,
    createLinkedInPost,
    deleteLinkedInPost,
    escapeLinkedInCommentary,
    getLinkedInMember,
    getOrganizationFollowerCount,
    getOrganizationPostStats,
    LinkedInApiError,
    listAdministeredOrganizations,
    listLinkedInComments,
    uploadLinkedInImage,
} from "@launchstack/tools/social-publish/linkedin";

const BASE = "https://li.test";
const PAGE = "urn:li:organization:2414183";

interface Call {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: unknown;
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

/** A fetch that answers by URL substring, in order, and records every call. */
function router(routes: Array<[string | RegExp, Handler]>) {
    const calls: Call[] = [];
    const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push({
            url,
            method: init.method ?? "GET",
            headers: (init.headers ?? {}) as Record<string, string>,
            body: init.body,
        });
        for (const [match, handler] of routes) {
            if (typeof match === "string" ? url.includes(match) : match.test(url)) {
                return handler(url, init);
            }
        }
        throw new Error(`unexpected fetch: ${init.method ?? "GET"} ${url}`);
    });
    return { fetch, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
    });

const created = (id: string) => new Response(null, { status: 201, headers: { "x-restli-id": id } });

const bodyOf = (call: Call | undefined) =>
    JSON.parse(String(call?.body)) as Record<string, unknown>;

const savedVersion = process.env.LINKEDIN_API_VERSION;
const savedBase = process.env.LINKEDIN_API_BASE_URL;

beforeEach(() => {
    delete process.env.LINKEDIN_API_VERSION;
    delete process.env.LINKEDIN_API_BASE_URL;
});
afterEach(() => {
    if (savedVersion === undefined) delete process.env.LINKEDIN_API_VERSION;
    else process.env.LINKEDIN_API_VERSION = savedVersion;
    if (savedBase === undefined) delete process.env.LINKEDIN_API_BASE_URL;
    else process.env.LINKEDIN_API_BASE_URL = savedBase;
});

describe("escapeLinkedInCommentary", () => {
    it("backslash-escapes every little-text reserved character", () => {
        expect(escapeLinkedInCommentary("a\\b|c{d}e@f[g]h(i)j<k>l*m_n~o")).toBe(
            "a\\\\b\\|c\\{d\\}e\\@f\\[g\\]h\\(i\\)j\\<k\\>l\\*m\\_n\\~o"
        );
    });

    it("keeps word hashtags clickable and escapes stray #", () => {
        expect(escapeLinkedInCommentary("Ship it #launch_day! We're #1 at a#b")).toBe(
            "Ship it {hashtag|\\#|launch\\_day}! We're \\#1 at a\\#b"
        );
        expect(escapeLinkedInCommentary("#Ünïcode first")).toBe("{hashtag|\\#|Ünïcode} first");
        expect(escapeLinkedInCommentary("see https://x.test/#/docs")).toBe(
            "see https://x.test/\\#/docs"
        );
    });

    it("can escape hashtags as plain text", () => {
        expect(escapeLinkedInCommentary("#tag", { hashtags: false })).toBe("\\#tag");
    });

    it("leaves ordinary text alone", () => {
        expect(escapeLinkedInCommentary("Hello, world. 50% off!\nNew line")).toBe(
            "Hello, world. 50% off!\nNew line"
        );
    });
});

describe("createLinkedInPost", () => {
    it("posts as a Page with the versioned headers and returns the x-restli-id URN", async () => {
        const { fetch, calls } = router([["/rest/posts", () => created("urn:li:share:7001")]]);

        const result = await createLinkedInPost({
            accessToken: "tok",
            apiBaseUrl: `${BASE}/`,
            fetch,
            authorUrn: PAGE,
            text: "We shipped (finally) #launch",
        });

        expect(result).toEqual({
            postUrn: "urn:li:share:7001",
            postUrl: "https://www.linkedin.com/feed/update/urn:li:share:7001",
        });
        expect(calls).toHaveLength(1);
        const [call] = calls;
        expect(call!.url).toBe(`${BASE}/rest/posts`);
        expect(call!.method).toBe("POST");
        expect(call!.headers).toMatchObject({
            Authorization: "Bearer tok",
            "LinkedIn-Version": "202609",
            "X-Restli-Protocol-Version": "2.0.0",
            "Content-Type": "application/json",
        });
        expect(bodyOf(call)).toEqual({
            author: PAGE,
            commentary: "We shipped \\(finally\\) {hashtag|\\#|launch}",
            visibility: "PUBLIC",
            distribution: {
                feedDistribution: "MAIN_FEED",
                targetEntities: [],
                thirdPartyDistributionChannels: [],
            },
            lifecycleState: "PUBLISHED",
            isReshareDisabledByAuthor: false,
        });
    });

    it("honours LINKEDIN_API_VERSION and LINKEDIN_API_BASE_URL", async () => {
        process.env.LINKEDIN_API_VERSION = "202610";
        process.env.LINKEDIN_API_BASE_URL = "http://localhost:3042/dev/stand-ins/linkedin/";
        const { fetch, calls } = router([["/rest/posts", () => created("urn:li:share:1")]]);

        await createLinkedInPost({ accessToken: "t", fetch, authorUrn: PAGE, text: "hi" });

        expect(calls[0]!.url).toBe("http://localhost:3042/dev/stand-ins/linkedin/rest/posts");
        expect(calls[0]!.headers["LinkedIn-Version"]).toBe("202610");
    });

    it("uploads one image (initializeUpload, then PUT) and attaches it as content.media", async () => {
        const bytes = new Uint8Array([1, 2, 3, 4]);
        const { fetch, calls } = router([
            [
                "/rest/images?action=initializeUpload",
                () =>
                    json({
                        value: {
                            uploadUrl: "https://upload.li.test/dms/abc?sig=1",
                            image: "urn:li:image:C4E10",
                        },
                    }),
            ],
            ["https://upload.li.test/", () => new Response(null, { status: 201 })],
            ["/rest/posts", () => created("urn:li:ugcPost:99")],
        ]);

        const result = await createLinkedInPost({
            accessToken: "tok",
            apiBaseUrl: BASE,
            fetch,
            authorUrn: PAGE,
            text: "With a picture",
            media: [{ data: bytes, mimeType: "image/png", alt: "Our team" }],
        });

        expect(result.postUrn).toBe("urn:li:ugcPost:99");
        expect(calls.map(c => `${c.method} ${c.url}`)).toEqual([
            `POST ${BASE}/rest/images?action=initializeUpload`,
            "PUT https://upload.li.test/dms/abc?sig=1",
            `POST ${BASE}/rest/posts`,
        ]);
        expect(bodyOf(calls[0])).toEqual({ initializeUploadRequest: { owner: PAGE } });
        expect(calls[1]!.headers).toMatchObject({
            Authorization: "Bearer tok",
            "Content-Type": "image/png",
        });
        expect(calls[1]!.headers["LinkedIn-Version"]).toBeUndefined();
        expect(calls[1]!.body).toBe(bytes);
        expect(bodyOf(calls[2]).content).toEqual({
            media: { id: "urn:li:image:C4E10", altText: "Our team" },
        });
    });

    it("sends two or more images as content.multiImage", async () => {
        let n = 0;
        const { fetch, calls } = router([
            [
                "initializeUpload",
                () => {
                    n++;
                    return json({
                        value: {
                            uploadUrl: `https://upload.li.test/${n}`,
                            image: `urn:li:image:I${n}`,
                        },
                    });
                },
            ],
            ["https://upload.li.test/", () => new Response(null, { status: 201 })],
            ["/rest/posts", () => created("urn:li:share:5")],
        ]);

        await createLinkedInPost({
            accessToken: "tok",
            apiBaseUrl: BASE,
            fetch,
            authorUrn: "urn:li:person:abc",
            text: "Gallery",
            media: [
                { data: new Uint8Array([1]), mimeType: "image/jpeg", alt: "First" },
                { data: new Uint8Array([2]), mimeType: "image/jpg" },
            ],
        });

        const post = calls.find(c => c.url.endsWith("/rest/posts"));
        expect(bodyOf(post).content).toEqual({
            multiImage: {
                images: [{ id: "urn:li:image:I1", altText: "First" }, { id: "urn:li:image:I2" }],
            },
        });
        expect(calls.filter(c => c.method === "PUT").map(c => c.headers["Content-Type"])).toEqual([
            "image/jpeg",
            "image/jpeg",
        ]);
    });

    it("refuses WebP before touching the network", async () => {
        const { fetch } = router([]);
        const attempt = createLinkedInPost({
            accessToken: "tok",
            apiBaseUrl: BASE,
            fetch,
            authorUrn: PAGE,
            text: "x",
            media: [{ data: new Uint8Array([1]), mimeType: "image/webp" }],
        });
        await expect(attempt).rejects.toThrow("LinkedIn takes JPG, PNG or GIF images");
        await expect(attempt).rejects.toMatchObject({ authFailed: false, retryable: false });
        expect(fetch).not.toHaveBeenCalled();
    });

    it("falls back to the JSON id, and decodes an encoded x-restli-id", async () => {
        const viaBody = router([["/rest/posts", () => json({ id: "urn:li:share:42" }, 201)]]);
        const a = await createLinkedInPost({
            accessToken: "t",
            apiBaseUrl: BASE,
            fetch: viaBody.fetch,
            authorUrn: PAGE,
            text: "a",
        });
        expect(a.postUrn).toBe("urn:li:share:42");

        const encoded = router([["/rest/posts", () => created("urn%3Ali%3Ashare%3A43")]]);
        const b = await createLinkedInPost({
            accessToken: "t",
            apiBaseUrl: BASE,
            fetch: encoded.fetch,
            authorUrn: PAGE,
            text: "b",
        });
        expect(b.postUrn).toBe("urn:li:share:43");
    });
});

describe("createLinkedInPost never retries a create that may have happened", () => {
    const opts = (fetch: ReturnType<typeof router>["fetch"]) => ({
        accessToken: "tok",
        apiBaseUrl: BASE,
        fetch,
        authorUrn: PAGE,
        text: "Hello",
    });

    it("a 504 on the create call fails without retry and asks to check the Page", async () => {
        const { fetch } = router([
            ["/rest/posts", () => json({ message: "Gateway Timeout" }, 504)],
        ]);
        await expect(createLinkedInPost(opts(fetch))).rejects.toMatchObject({
            retryable: false,
            authFailed: false,
            message: expect.stringContaining("Check the Page before publishing again"),
        });
    });

    it("a connection dropped after the request went out fails without retry", async () => {
        const { fetch } = router([
            [
                "/rest/posts",
                () => {
                    throw new TypeError("socket hang up");
                },
            ],
        ]);
        await expect(createLinkedInPost(opts(fetch))).rejects.toMatchObject({ retryable: false });
    });

    it("a 429 on the create call is a clean refusal and stays retryable", async () => {
        const { fetch } = router([["/rest/posts", () => json({ message: "Throttled" }, 429)]]);
        await expect(createLinkedInPost(opts(fetch))).rejects.toMatchObject({ retryable: true });
    });

    it("an outage while uploading the image, before the post exists, stays retryable", async () => {
        const { fetch, calls } = router([
            ["action=initializeUpload", () => json({ message: "unavailable" }, 503)],
        ]);
        await expect(
            createLinkedInPost({
                ...opts(fetch),
                media: [{ data: new Uint8Array([1]), mimeType: "image/png" }],
            })
        ).rejects.toMatchObject({ retryable: true });
        expect(calls.some(c => c.url.endsWith("/rest/posts"))).toBe(false);
    });
});

describe("LinkedIn error classification", () => {
    const post = (fetch: ReturnType<typeof router>["fetch"]) =>
        createLinkedInPost({
            accessToken: "t",
            apiBaseUrl: BASE,
            fetch,
            authorUrn: PAGE,
            text: "x",
        });

    it("401 is authFailed", async () => {
        const { fetch } = router([
            [
                "/rest/posts",
                () =>
                    json(
                        {
                            status: 401,
                            serviceErrorCode: 65601,
                            message: "The token used in the request has been revoked by the user",
                        },
                        401
                    ),
            ],
        ]);
        const err = await post(fetch).catch(e => e as LinkedInApiError);
        expect(err).toBeInstanceOf(LinkedInApiError);
        expect(err).toMatchObject({ status: 401, authFailed: true, retryable: false });
        expect((err as Error).message).toContain("revoked");
    });

    it("403 naming an expired token is authFailed", async () => {
        const { fetch } = router([
            [
                "/rest/posts",
                () =>
                    json(
                        { status: 403, message: "The token used in the request has expired" },
                        403
                    ),
            ],
        ]);
        await expect(post(fetch)).rejects.toMatchObject({ authFailed: true, retryable: false });
    });

    it("403 for a missing permission is neither, and says which permission", async () => {
        const { fetch } = router([
            [
                "/rest/posts",
                () =>
                    json(
                        {
                            status: 403,
                            code: "ACCESS_DENIED",
                            message:
                                "Not enough permissions to access: partnerApiPostsExternal.CREATE.20260901",
                        },
                        403
                    ),
            ],
        ]);
        const err = (await post(fetch).catch(e => e)) as LinkedInApiError;
        expect(err).toMatchObject({ status: 403, authFailed: false, retryable: false });
        expect(err.message).toContain("partnerApiPostsExternal.CREATE");
    });

    it("429, 5xx and network failures are retryable (reads; a create only on 429)", async () => {
        const limited = router([
            ["/rest/posts", () => json({ message: "Too many requests" }, 429)],
        ]);
        await expect(post(limited.fetch)).rejects.toMatchObject({
            status: 429,
            authFailed: false,
            retryable: true,
        });

        const read = (fetch: ReturnType<typeof router>["fetch"]) =>
            listLinkedInComments({
                accessToken: "t",
                apiBaseUrl: BASE,
                fetch,
                postUrn: "urn:li:share:1",
            });
        const down = router([["/comments", () => new Response("bad gateway", { status: 502 })]]);
        await expect(read(down.fetch)).rejects.toMatchObject({ status: 502, retryable: true });

        const offline = router([
            [
                "/comments",
                () => {
                    throw new TypeError("fetch failed");
                },
            ],
        ]);
        await expect(read(offline.fetch)).rejects.toMatchObject({ status: 0, retryable: true });
    });
});

describe("uploadLinkedInImage", () => {
    it("returns the image URN and resolves a relative upload URL against the base", async () => {
        const { fetch, calls } = router([
            [
                "initializeUpload",
                () => json({ value: { uploadUrl: "/dev/upload/1", image: "urn:li:image:R1" } }),
            ],
            ["/dev/upload/1", () => new Response(null, { status: 201 })],
        ]);
        const urn = await uploadLinkedInImage({
            accessToken: "t",
            apiBaseUrl: "http://localhost:3042/dev/stand-ins/linkedin",
            fetch,
            ownerUrn: PAGE,
            image: { data: new Uint8Array([9]), mimeType: "image/gif" },
        });
        expect(urn).toBe("urn:li:image:R1");
        expect(calls[1]!.url).toBe("http://localhost:3042/dev/upload/1");
    });
});

describe("deleteLinkedInPost", () => {
    it("sends X-RestLi-Method: DELETE to the encoded URN; 404 counts as done", async () => {
        const { fetch, calls } = router([
            ["/rest/posts/", () => new Response(null, { status: 404 })],
        ]);
        await deleteLinkedInPost({
            accessToken: "t",
            apiBaseUrl: BASE,
            fetch,
            postUrn: "urn:li:share:7",
        });
        expect(calls[0]!.method).toBe("DELETE");
        expect(calls[0]!.url).toBe(`${BASE}/rest/posts/urn%3Ali%3Ashare%3A7`);
        expect(calls[0]!.headers["X-RestLi-Method"]).toBe("DELETE");
    });
});

describe("getLinkedInMember", () => {
    it("reads OpenID userinfo", async () => {
        const { fetch, calls } = router([
            [
                "/v2/userinfo",
                () =>
                    json({
                        sub: "abc",
                        name: "Ada Lovelace",
                        email: "ada@x.test",
                        picture: "https://p/ada.jpg",
                    }),
            ],
        ]);
        const member = await getLinkedInMember({ accessToken: "t", apiBaseUrl: BASE, fetch });
        expect(member).toEqual({
            id: "abc",
            urn: "urn:li:person:abc",
            name: "Ada Lovelace",
            email: "ada@x.test",
            pictureUrl: "https://p/ada.jpg",
        });
        expect(calls[0]!.headers.Authorization).toBe("Bearer t");
    });

    it("falls back to /v2/me when userinfo is refused", async () => {
        const { fetch, calls } = router([
            [
                "/v2/userinfo",
                () => json({ message: "Not enough permissions to access: userinfo" }, 403),
            ],
            [
                "/v2/me",
                () =>
                    json({
                        id: "xyz",
                        localizedFirstName: "Grace",
                        localizedLastName: "Hopper",
                        profilePicture: {
                            "displayImage~": {
                                elements: [
                                    { identifiers: [{ identifier: "https://p/small.jpg" }] },
                                    { identifiers: [{ identifier: "https://p/large.jpg" }] },
                                ],
                            },
                        },
                    }),
            ],
        ]);
        const member = await getLinkedInMember({ accessToken: "t", apiBaseUrl: BASE, fetch });
        expect(member).toEqual({
            id: "xyz",
            urn: "urn:li:person:xyz",
            name: "Grace Hopper",
            email: null,
            pictureUrl: "https://p/large.jpg",
        });
        expect(calls[1]!.url).toContain("/v2/me?projection=(id,localizedFirstName");
        expect(calls[1]!.headers["X-Restli-Protocol-Version"]).toBe("2.0.0");
    });

    it("both endpoints answering 401 is authFailed", async () => {
        const { fetch } = router([
            ["/v2/userinfo", () => json({ message: "Invalid access token" }, 401)],
            ["/v2/me", () => json({ message: "Invalid access token" }, 401)],
        ]);
        await expect(
            getLinkedInMember({ accessToken: "t", apiBaseUrl: BASE, fetch })
        ).rejects.toMatchObject({ status: 401, authFailed: true });
    });
});

describe("listAdministeredOrganizations", () => {
    it("keeps admin roles, dedupes with ADMINISTRATOR winning, and tolerates a missing logo", async () => {
        const { fetch, calls } = router([
            [
                "/rest/organizationAcls",
                () =>
                    json({
                        elements: [
                            {
                                role: "CONTENT_ADMINISTRATOR",
                                state: "APPROVED",
                                organization: "urn:li:organization:1",
                            },
                            {
                                role: "ADMINISTRATOR",
                                state: "APPROVED",
                                organization: "urn:li:organization:1",
                            },
                            {
                                role: "ADMINISTRATOR",
                                state: "APPROVED",
                                organizationTarget: "urn:li:organization:2",
                            },
                            {
                                role: "ANALYST",
                                state: "APPROVED",
                                organization: "urn:li:organization:3",
                            },
                            {
                                role: "CONTENT_ADMINISTRATOR",
                                state: "APPROVED",
                                organization: "urn:li:organization:4",
                            },
                        ],
                    }),
            ],
            [
                "/rest/organizations/1",
                () =>
                    json({
                        id: 1,
                        localizedName: "Acme",
                        vanityName: "acme",
                        logoV2: { original: "urn:li:digitalmediaAsset:LOGO1" },
                    }),
            ],
            [
                "/rest/organizations/2",
                () =>
                    json({
                        id: 2,
                        localizedName: "Beta",
                        logoV2: { original: "urn:li:image:LOGO2" },
                    }),
            ],
            ["/rest/organizations/4", () => json({ message: "Not enough permissions" }, 403)],
            [
                "/rest/images/urn%3Ali%3Aimage%3ALOGO1",
                () =>
                    json({
                        id: "urn:li:image:LOGO1",
                        downloadUrl: "https://media.li.test/logo1.png",
                    }),
            ],
            ["/rest/images/urn%3Ali%3Aimage%3ALOGO2", () => json({ message: "forbidden" }, 403)],
        ]);

        const orgs = await listAdministeredOrganizations({
            accessToken: "t",
            apiBaseUrl: BASE,
            fetch,
        });

        expect(orgs).toEqual([
            {
                id: "1",
                urn: "urn:li:organization:1",
                name: "Acme",
                vanityName: "acme",
                logoUrl: "https://media.li.test/logo1.png",
                role: "ADMINISTRATOR",
            },
            {
                id: "2",
                urn: "urn:li:organization:2",
                name: "Beta",
                vanityName: null,
                logoUrl: null,
                role: "ADMINISTRATOR",
            },
            {
                id: "4",
                urn: "urn:li:organization:4",
                name: "LinkedIn Page 4",
                vanityName: null,
                logoUrl: null,
                role: "CONTENT_ADMINISTRATOR",
            },
        ]);
        const acl = calls[0]!;
        expect(acl.url).toBe(
            `${BASE}/rest/organizationAcls?q=roleAssignee&state=APPROVED&count=100&start=0`
        );
        expect(acl.headers["LinkedIn-Version"]).toBe("202609");
        expect(calls.some(c => c.url.includes("/rest/organizations/3"))).toBe(false);
    });

    it("returns [] when the token has no Pages access (403 on organizationAcls)", async () => {
        const { fetch, calls } = router([
            [
                "/rest/organizationAcls",
                () =>
                    json(
                        {
                            message:
                                "Not enough permissions to access: organizationAcls.FINDER-roleAssignee",
                        },
                        403
                    ),
            ],
        ]);
        await expect(
            listAdministeredOrganizations({ accessToken: "t", apiBaseUrl: BASE, fetch })
        ).resolves.toEqual([]);
        expect(calls).toHaveLength(1);
    });

    it("still fails on a refused token", async () => {
        const { fetch } = router([
            ["/rest/organizationAcls", () => json({ message: "expired" }, 401)],
        ]);
        await expect(
            listAdministeredOrganizations({ accessToken: "t", apiBaseUrl: BASE, fetch })
        ).rejects.toMatchObject({ authFailed: true });
    });
});

describe("getOrganizationPostStats", () => {
    it("asks with Rest.li List() per URN kind and maps totalShareStatistics", async () => {
        const { fetch, calls } = router([
            [
                "/rest/organizationalEntityShareStatistics",
                () =>
                    json({
                        elements: [
                            {
                                organizationalEntity: PAGE,
                                share: "urn:li:share:1",
                                totalShareStatistics: {
                                    impressionCount: 5287,
                                    uniqueImpressionsCount: 4000,
                                    clickCount: 78,
                                    likeCount: 14,
                                    commentCount: 24,
                                    shareCount: 5,
                                    engagement: 0.0228,
                                },
                            },
                            {
                                organizationalEntity: PAGE,
                                ugcPost: "urn:li:ugcPost:3",
                                totalShareStatistics: { impressionCount: 5, likeCount: -1 },
                            },
                        ],
                    }),
            ],
        ]);

        const stats = await getOrganizationPostStats({
            accessToken: "t",
            apiBaseUrl: BASE,
            fetch,
            organizationUrn: PAGE,
            postUrns: ["urn:li:share:1", "urn:li:share:2", "urn:li:ugcPost:3", "urn:li:activity:9"],
        });

        expect(calls).toHaveLength(1);
        expect(calls[0]!.url).toBe(
            `${BASE}/rest/organizationalEntityShareStatistics?q=organizationalEntity` +
                `&organizationalEntity=urn%3Ali%3Aorganization%3A2414183` +
                `&shares=List(urn%3Ali%3Ashare%3A1,urn%3Ali%3Ashare%3A2)` +
                `&ugcPosts=List(urn%3Ali%3AugcPost%3A3)`
        );
        expect(stats.get("urn:li:share:1")).toEqual({
            postUrn: "urn:li:share:1",
            impressions: 5287,
            uniqueImpressions: 4000,
            clicks: 78,
            reactions: 14,
            comments: 24,
            shares: 5,
            engagement: 0.0228,
        });
        expect(stats.get("urn:li:ugcPost:3")).toEqual({
            postUrn: "urn:li:ugcPost:3",
            impressions: 5,
            uniqueImpressions: null,
            clicks: 0,
            reactions: 0,
            comments: 0,
            shares: 0,
            engagement: null,
        });
        expect(stats.has("urn:li:share:2")).toBe(false);
    });

    it("chunks 20 URNs per call and omits an empty List()", async () => {
        const { fetch, calls } = router([
            ["/rest/organizationalEntityShareStatistics", () => json({ elements: [] })],
        ]);
        const postUrns = Array.from({ length: 25 }, (_, i) => `urn:li:share:${i}`);
        await getOrganizationPostStats({
            accessToken: "t",
            apiBaseUrl: BASE,
            fetch,
            organizationUrn: PAGE,
            postUrns,
        });
        expect(calls).toHaveLength(2);
        expect(calls[0]!.url.match(/urn%3Ali%3Ashare/g)).toHaveLength(20);
        expect(calls[1]!.url.match(/urn%3Ali%3Ashare/g)).toHaveLength(5);
        expect(calls[0]!.url).not.toContain("ugcPosts");
    });
});

describe("getOrganizationFollowerCount", () => {
    it("reads firstDegreeSize; 403 and 404 are null", async () => {
        const ok = router([["/rest/networkSizes/", () => json({ firstDegreeSize: 1234 })]]);
        await expect(
            getOrganizationFollowerCount({
                accessToken: "t",
                apiBaseUrl: BASE,
                fetch: ok.fetch,
                organizationUrn: PAGE,
            })
        ).resolves.toBe(1234);
        expect(ok.calls[0]!.url).toBe(
            `${BASE}/rest/networkSizes/urn%3Ali%3Aorganization%3A2414183?edgeType=COMPANY_FOLLOWED_BY_MEMBER`
        );

        for (const status of [403, 404]) {
            const refused = router([
                ["/rest/networkSizes/", () => json({ message: "no" }, status)],
            ]);
            await expect(
                getOrganizationFollowerCount({
                    accessToken: "t",
                    apiBaseUrl: BASE,
                    fetch: refused.fetch,
                    organizationUrn: PAGE,
                })
            ).resolves.toBeNull();
        }
    });
});

describe("comments", () => {
    const POST = "urn:li:share:6305471423242596352";
    const C1 = "urn:li:comment:(urn:li:activity:6305,111)";

    it("lists comments newest first, with decorated names and nested replies", async () => {
        const { fetch, calls } = router([
            [
                `/rest/socialActions/${encodeURIComponent(POST)}/comments`,
                () =>
                    json({
                        elements: [
                            {
                                commentUrn: C1,
                                id: "111",
                                actor: "urn:li:person:a",
                                "actor~": { localizedFirstName: "Ann", localizedLastName: "Lee" },
                                message: { text: "First!" },
                                created: { actor: "urn:li:person:a", time: 1_700_000_000_000 },
                                object: "urn:li:activity:6305",
                                commentsSummary: { aggregatedTotalComments: 1 },
                            },
                            {
                                $URN: "urn:li:comment:(urn:li:activity:6305,222)",
                                actor: "urn:li:organization:5",
                                message: { text: "Thanks" },
                                created: { time: 1_700_000_100_000 },
                            },
                        ],
                    }),
            ],
            [
                "/rest/socialActions/urn%3Ali%3Acomment%3A%28urn%3Ali%3Aactivity%3A6305%2C111%29/comments",
                () =>
                    json({
                        elements: [
                            {
                                commentUrn: "urn:li:comment:(urn:li:activity:6305,333)",
                                id: "333",
                                actor: "urn:li:person:b",
                                message: { text: "Reply" },
                                created: { time: 1_700_000_200_000 },
                                object: "urn:li:activity:6305",
                            },
                        ],
                    }),
            ],
        ]);

        const comments = await listLinkedInComments({
            accessToken: "t",
            apiBaseUrl: BASE,
            fetch,
            postUrn: POST,
            count: 20,
        });

        expect(calls[0]!.url).toBe(
            `${BASE}/rest/socialActions/urn%3Ali%3Ashare%3A6305471423242596352/comments?count=20&projection=(elements*(*,actor~(localizedFirstName,localizedLastName,localizedName,vanityName)))`
        );
        expect(comments.map(c => c.id)).toEqual(["333", "222", "111"]);
        expect(comments[0]).toMatchObject({
            urn: "urn:li:comment:(urn:li:activity:6305,333)",
            parentCommentUrn: C1,
            actorUrn: "urn:li:person:b",
            actorName: null,
            text: "Reply",
        });
        expect(comments[1]).toMatchObject({
            urn: "urn:li:comment:(urn:li:activity:6305,222)",
            objectUrn: POST,
            parentCommentUrn: null,
            actorUrn: "urn:li:organization:5",
        });
        expect(comments[2]).toMatchObject({
            urn: C1,
            objectUrn: "urn:li:activity:6305",
            actorName: "Ann Lee",
            createdAt: new Date(1_700_000_000_000),
        });
    });

    it("asks again without the actor projection when LinkedIn rejects it", async () => {
        const { fetch, calls } = router([
            [
                "projection=",
                () =>
                    json(
                        { status: 400, message: "Projection is not supported for this version" },
                        400
                    ),
            ],
            [
                "/comments?count=50",
                () =>
                    json({
                        elements: [
                            {
                                commentUrn: C1,
                                id: "111",
                                actor: "urn:li:person:a",
                                message: { text: "Hi" },
                                created: { time: 1_700_000_000_000 },
                            },
                        ],
                    }),
            ],
        ]);
        const comments = await listLinkedInComments({
            accessToken: "t",
            apiBaseUrl: BASE,
            fetch,
            postUrn: POST,
        });
        expect(calls).toHaveLength(2);
        expect(calls[1]!.url).not.toContain("projection=");
        expect(comments).toHaveLength(1);
        expect(comments[0]!.actorName).toBeNull();
    });

    it("does not retry a refused token without the projection", async () => {
        const { fetch, calls } = router([
            ["/comments", () => json({ status: 401, code: "REVOKED_ACCESS_TOKEN" }, 401)],
        ]);
        await expect(
            listLinkedInComments({ accessToken: "t", apiBaseUrl: BASE, fetch, postUrn: POST })
        ).rejects.toMatchObject({ authFailed: true });
        expect(calls).toHaveLength(1);
    });

    it("replies on the parent comment's thread, with object = the post", async () => {
        const { fetch, calls } = router([
            [
                "/comments",
                () =>
                    json(
                        {
                            actor: PAGE,
                            commentUrn: "urn:li:comment:(urn:li:activity:6305,444)",
                            id: "444",
                            created: { actor: PAGE, time: 1_700_000_300_000 },
                            message: { text: "Glad you like it" },
                            object: "urn:li:activity:6305",
                            parentComment: C1,
                        },
                        201,
                        { "x-restli-id": "444" }
                    ),
            ],
        ]);

        const reply = await createLinkedInComment({
            accessToken: "t",
            apiBaseUrl: BASE,
            fetch,
            actorUrn: PAGE,
            postUrn: POST,
            parentCommentUrn: C1,
            text: "Glad you like it",
        });

        expect(calls[0]!.method).toBe("POST");
        expect(calls[0]!.url).toBe(
            `${BASE}/rest/socialActions/urn%3Ali%3Acomment%3A%28urn%3Ali%3Aactivity%3A6305%2C111%29/comments`
        );
        expect(bodyOf(calls[0])).toEqual({
            actor: PAGE,
            object: POST,
            message: { text: "Glad you like it" },
            parentComment: C1,
        });
        expect(reply).toMatchObject({
            urn: "urn:li:comment:(urn:li:activity:6305,444)",
            id: "444",
            parentCommentUrn: C1,
            actorUrn: PAGE,
            text: "Glad you like it",
        });
    });

    it("comments on the post itself and rebuilds the comment from the header when no body comes back", async () => {
        const { fetch, calls } = router([["/comments", () => created("555")]]);
        const comment = await createLinkedInComment({
            accessToken: "t",
            apiBaseUrl: BASE,
            fetch,
            actorUrn: PAGE,
            postUrn: POST,
            text: "Hello",
        });
        expect(calls[0]!.url).toBe(
            `${BASE}/rest/socialActions/urn%3Ali%3Ashare%3A6305471423242596352/comments`
        );
        expect(bodyOf(calls[0])).toEqual({ actor: PAGE, object: POST, message: { text: "Hello" } });
        expect(comment).toMatchObject({
            id: "555",
            urn: `urn:li:comment:(${POST},555)`,
            parentCommentUrn: null,
            actorUrn: PAGE,
            text: "Hello",
        });
    });
});
