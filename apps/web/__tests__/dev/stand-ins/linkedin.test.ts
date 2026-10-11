/**
 * The LinkedIn stand-in, driven over HTTP-shaped Requests the way an app's
 * client would: OAuth consent → code → token, identity, Pages, image upload
 * and posting, share statistics with Rest.li List() parameters, comments
 * and replies, and the token failures (revoked, expired) an app must handle.
 */
import { handleLinkedInRequest } from "~/app/dev/stand-ins/linkedin/dispatch";
import { renderLittleText } from "~/app/dev/stand-ins/linkedin/little-text";
import {
    checkAuthorizationRequest,
    linkedInSnapshot,
    linkedInWorld,
    resetLinkedInWorld,
} from "~/app/dev/stand-ins/linkedin/world";
import { standInClock } from "~/app/dev/stand-ins/shared/store";

const ORIGIN = "http://standin.test";
const BASE = `${ORIGIN}/dev/stand-ins/linkedin`;
const REDIRECT = "http://localhost:3000/api/connectors/linkedin/oauth/callback";
const CLIENT = { client_id: "app-123", client_secret: "secret-456" };
const VERSION = "202610";
const ORG = "urn:li:organization:104857";
const LABS = "urn:li:organization:209114";
const PAGE_SCOPES = [
    "openid",
    "profile",
    "email",
    "rw_organization_admin",
    "w_organization_social",
    "r_organization_social",
];

let now = Date.UTC(2026, 9, 11, 12, 0, 0);
const realNow = standInClock.now;

beforeEach(() => {
    now = Date.UTC(2026, 9, 11, 12, 0, 0);
    standInClock.now = () => now;
    resetLinkedInWorld();
});

afterAll(() => {
    standInClock.now = realNow;
});

const advance = (seconds: number) => {
    now += seconds * 1000;
};

interface CallOptions {
    token?: string;
    json?: unknown;
    form?: Record<string, string>;
    body?: Uint8Array<ArrayBuffer>;
    headers?: Record<string, string>;
    version?: string | null;
}

function call(method: string, path: string, opts: CallOptions = {}): Promise<Response> {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (path.startsWith("/rest/") && opts.version !== null) {
        headers["linkedin-version"] = opts.version ?? VERSION;
    }
    let body: BodyInit | undefined;
    if (opts.json !== undefined) {
        headers["content-type"] = "application/json";
        body = JSON.stringify(opts.json);
    } else if (opts.form) {
        headers["content-type"] = "application/x-www-form-urlencoded";
        body = new URLSearchParams(opts.form).toString();
    } else if (opts.body) {
        body = opts.body;
    }
    return handleLinkedInRequest(new Request(`${BASE}${path}`, { method, headers, body }));
}

async function consent(scopes: string[], decision: "allow" | "cancel" = "allow") {
    const res = await call("POST", "/oauth/v2/consent", {
        form: {
            client_id: CLIENT.client_id,
            redirect_uri: REDIRECT,
            scope: scopes.join(" "),
            state: "st-1",
            decision,
        },
    });
    expect(res.status).toBe(302);
    return new URL(res.headers.get("location")!);
}

async function connect(scopes: string[] = PAGE_SCOPES) {
    const back = await consent(scopes);
    const res = await call("POST", "/oauth/v2/accessToken", {
        form: {
            grant_type: "authorization_code",
            code: back.searchParams.get("code")!,
            redirect_uri: REDIRECT,
            ...CLIENT,
        },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as {
        access_token: string;
        expires_in: number;
        scope: string;
        refresh_token?: string;
        refresh_token_expires_in?: number;
        id_token?: string;
    };
}

const enc = encodeURIComponent;

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function uploadImage(token: string, owner = ORG): Promise<string> {
    const init = await call("POST", "/rest/images?action=initializeUpload", {
        token,
        json: { initializeUploadRequest: { owner } },
    });
    expect(init.status).toBe(200);
    const { value } = (await init.json()) as {
        value: { uploadUrl: string; image: string; uploadUrlExpiresAt: number };
    };
    expect(value.image).toMatch(/^urn:li:image:/);
    expect(value.uploadUrl).toMatch(new RegExp(`^${BASE}/upload/`));
    const put = await handleLinkedInRequest(
        new Request(value.uploadUrl, {
            method: "PUT",
            headers: { authorization: `Bearer ${token}`, "content-type": "image/png" },
            body: PNG,
        })
    );
    expect(put.status).toBe(201);
    return value.image;
}

function postBody(author: string, commentary: string, content?: unknown) {
    return {
        author,
        commentary,
        visibility: "PUBLIC",
        distribution: {
            feedDistribution: "MAIN_FEED",
            targetEntities: [],
            thirdPartyDistributionChannels: [],
        },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
        ...(content ? { content } : {}),
    };
}

async function publish(token: string, author = ORG, commentary = "Hello", content?: unknown) {
    const res = await call("POST", "/rest/posts", {
        token,
        json: postBody(author, commentary, content),
    });
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("");
    return res.headers.get("x-restli-id")!;
}

describe("authorization request", () => {
    it("rejects a missing client_id or a relative redirect_uri on its own page", () => {
        const noClient = checkAuthorizationRequest(
            new URLSearchParams({ response_type: "code", redirect_uri: REDIRECT, scope: "openid" })
        );
        expect(noClient).toMatchObject({ ok: false, kind: "page" });
        const relative = checkAuthorizationRequest(
            new URLSearchParams({
                response_type: "code",
                client_id: "x",
                redirect_uri: "/callback",
                scope: "openid",
            })
        );
        expect(relative).toMatchObject({ ok: false, kind: "page" });
    });

    it("sends an unknown scope back to the app as unauthorized_scope_error", () => {
        const check = checkAuthorizationRequest(
            new URLSearchParams({
                response_type: "code",
                client_id: "x",
                redirect_uri: REDIRECT,
                scope: "openid w_everything",
                state: "s",
            })
        );
        expect(check.ok).toBe(false);
        if (check.ok || check.kind !== "redirect") throw new Error("expected a redirect");
        const url = new URL(check.location);
        expect(url.searchParams.get("error")).toBe("unauthorized_scope_error");
        expect(url.searchParams.get("state")).toBe("s");
    });

    it("Cancel returns user_cancelled_authorize with the state", async () => {
        const back = await consent(["openid"], "cancel");
        expect(back.origin + back.pathname).toBe(REDIRECT);
        expect(back.searchParams.get("error")).toBe("user_cancelled_authorize");
        expect(back.searchParams.get("error_description")).toBeTruthy();
        expect(back.searchParams.get("state")).toBe("st-1");
        expect(back.searchParams.get("code")).toBeNull();
    });
});

describe("code → token → userinfo", () => {
    it("issues a 60-day token, a refresh token for Pages scopes, and the member's identity", async () => {
        const back = await consent(PAGE_SCOPES);
        expect(back.searchParams.get("state")).toBe("st-1");
        const token = await connect();
        expect(token.expires_in).toBe(5_184_000);
        expect(token.scope.split(",")).toEqual(PAGE_SCOPES);
        expect(token.refresh_token).toBeTruthy();
        expect(token.refresh_token_expires_in).toBe(31_536_000);
        expect(token.id_token?.split(".")).toHaveLength(3);

        const res = await call("GET", "/v2/userinfo", { token: token.access_token });
        expect(res.status).toBe(200);
        const info = (await res.json()) as Record<string, unknown>;
        expect(info).toMatchObject({
            name: "Dana Okafor",
            given_name: "Dana",
            family_name: "Okafor",
            email: "dana.okafor@launchstack.example",
            email_verified: true,
        });
        expect(typeof info.sub).toBe("string");
        expect(info.picture).toMatch(/^http:\/\/standin\.test\/dev\/stand-ins\/linkedin\/assets\//);
    });

    it("member-only grants get no refresh token", async () => {
        const token = await connect(["openid", "profile", "w_member_social"]);
        expect(token.refresh_token).toBeUndefined();
    });

    it("a code works once, and only with its redirect_uri and the app's secret", async () => {
        const back = await consent(PAGE_SCOPES);
        const code = back.searchParams.get("code")!;
        const exchange = (form: Record<string, string>) =>
            call("POST", "/oauth/v2/accessToken", {
                form: {
                    grant_type: "authorization_code",
                    code,
                    redirect_uri: REDIRECT,
                    ...CLIENT,
                    ...form,
                },
            });

        const wrongRedirect = await exchange({ redirect_uri: "http://localhost:3000/other" });
        expect(wrongRedirect.status).toBe(400);
        expect(await wrongRedirect.json()).toMatchObject({ error: "invalid_redirect_uri" });

        expect((await exchange({})).status).toBe(200);

        const again = await exchange({});
        expect(again.status).toBe(401);
        expect(await again.json()).toMatchObject({ error: "invalid_request" });

        const back2 = await consent(PAGE_SCOPES);
        const wrongSecret = await call("POST", "/oauth/v2/accessToken", {
            form: {
                grant_type: "authorization_code",
                code: back2.searchParams.get("code")!,
                redirect_uri: REDIRECT,
                client_id: CLIENT.client_id,
                client_secret: "not-the-secret",
            },
        });
        expect(wrongSecret.status).toBe(401);
        expect(await wrongSecret.json()).toMatchObject({ error: "invalid_client" });
    });

    it("/v2/me needs a profile scope", async () => {
        const token = await connect(["openid", "email"]);
        const res = await call("GET", "/v2/me", { token: token.access_token });
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ status: 403, serviceErrorCode: 100 });
    });
});

describe("scopes, roles and versions", () => {
    it("lists the member's Pages with roles when the token has Pages scopes", async () => {
        const { access_token } = await connect();
        const res = await call("GET", "/rest/organizationAcls?q=roleAssignee&state=APPROVED", {
            token: access_token,
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            elements: { organization: string; role: string; state: string }[];
        };
        expect(body.elements.map(e => [e.organization, e.role])).toEqual([
            [ORG, "ADMINISTRATOR"],
            [LABS, "CONTENT_ADMINISTRATOR"],
        ]);

        const org = await call("GET", "/rest/organizations/104857", { token: access_token });
        const orgBody = (await org.json()) as {
            id: number;
            localizedName: string;
            vanityName: string;
            logoV2: { original: string };
        };
        expect(orgBody).toMatchObject({
            id: 104857,
            localizedName: "LaunchStack",
            vanityName: "launchstack",
        });

        const logo = await call("GET", `/rest/images/${enc(orgBody.logoV2.original)}`, {
            token: access_token,
        });
        const logoBody = (await logo.json()) as { downloadUrl: string; status: string };
        expect(logoBody.status).toBe("AVAILABLE");
        const svg = await handleLinkedInRequest(new Request(logoBody.downloadUrl));
        expect(svg.headers.get("content-type")).toBe("image/svg+xml");
    });

    it("answers 403 without Pages scopes", async () => {
        const { access_token } = await connect(["openid", "profile", "email", "w_member_social"]);
        const acls = await call("GET", "/rest/organizationAcls?q=roleAssignee", {
            token: access_token,
        });
        expect(acls.status).toBe(403);
        expect(await acls.json()).toMatchObject({
            status: 403,
            serviceErrorCode: 100,
            message: expect.stringContaining("Not enough permissions to access: organizationAcls"),
        });
        const post = await call("POST", "/rest/posts", {
            token: access_token,
            json: postBody(ORG, "Hi"),
        });
        expect(post.status).toBe(403);
    });

    it("requires a current LinkedIn-Version on /rest", async () => {
        const { access_token } = await connect();
        const missing = await call("GET", "/rest/organizationAcls?q=roleAssignee", {
            token: access_token,
            version: null,
        });
        expect(missing.status).toBe(400);
        expect(await missing.json()).toMatchObject({ code: "VERSION_MISSING" });
        const old = await call("GET", "/rest/organizationAcls?q=roleAssignee", {
            token: access_token,
            version: "202301",
        });
        expect(old.status).toBe(426);
    });

    it("refuses posts as a Page the member does not administer", async () => {
        const { access_token } = await connect();
        const res = await call("POST", "/rest/posts", {
            token: access_token,
            json: postBody("urn:li:organization:999", "Hi"),
        });
        expect(res.status).toBe(403);
    });
});

describe("token failures", () => {
    it("Revoke all → 401 REVOKED_ACCESS_TOKEN, and the refresh token is dead too", async () => {
        const token = await connect();
        const control = await call("POST", "/_standin/action", { json: { action: "revoke-all" } });
        expect(control.status).toBe(200);

        const res = await call("GET", "/v2/userinfo", { token: token.access_token });
        expect(res.status).toBe(401);
        expect(await res.json()).toMatchObject({
            status: 401,
            serviceErrorCode: 65600,
            code: "REVOKED_ACCESS_TOKEN",
        });

        const refresh = await call("POST", "/oauth/v2/accessToken", {
            form: { grant_type: "refresh_token", refresh_token: token.refresh_token!, ...CLIENT },
        });
        expect(refresh.status).toBe(400);
    });

    it("an expired access token is EXPIRED_ACCESS_TOKEN until refreshed", async () => {
        const token = await connect();
        await call("POST", "/_standin/action", { json: { action: "expire-access" } });
        const expired = await call("GET", "/v2/userinfo", { token: token.access_token });
        expect(expired.status).toBe(401);
        expect(await expired.json()).toMatchObject({ code: "EXPIRED_ACCESS_TOKEN" });

        const refreshed = await call("POST", "/oauth/v2/accessToken", {
            form: { grant_type: "refresh_token", refresh_token: token.refresh_token!, ...CLIENT },
        });
        expect(refreshed.status).toBe(200);
        const body = (await refreshed.json()) as { access_token: string; refresh_token: string };
        expect(body.refresh_token).toBe(token.refresh_token);
        expect((await call("GET", "/v2/userinfo", { token: body.access_token })).status).toBe(200);
    });

    it("POST /oauth/v2/revoke kills one token", async () => {
        const token = await connect();
        const res = await call("POST", "/oauth/v2/revoke", {
            form: { token: token.access_token, ...CLIENT },
        });
        expect(res.status).toBe(200);
        const after = await call("GET", "/v2/userinfo", { token: token.access_token });
        expect(after.status).toBe(401);
    });
});

describe("images and posts", () => {
    it("uploads an image and posts it as the Page", async () => {
        const { access_token } = await connect();
        const image = await uploadImage(access_token);

        const status = await call("GET", `/rest/images/${enc(image)}`, { token: access_token });
        const imageBody = (await status.json()) as { status: string; downloadUrl: string };
        expect(imageBody.status).toBe("AVAILABLE");
        const bytes = await handleLinkedInRequest(new Request(imageBody.downloadUrl));
        expect(bytes.headers.get("content-type")).toBe("image/png");
        expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(PNG);

        const urn = await publish(access_token, ORG, "Launch day \\(finally\\) \\#shipit", {
            media: { id: image, altText: "Our team" },
        });
        expect(urn).toMatch(/^urn:li:share:\d+$/);

        const post = linkedInSnapshot().posts[0]!;
        expect(post.urn).toBe(urn);
        expect(post.text).toBe("Launch day (finally) #shipit");
        expect(post.issues).toEqual([]);
        expect(post.images).toEqual([
            {
                url: expect.stringMatching(/^\/dev\/stand-ins\/linkedin\/assets\//),
                alt: "Our team",
            },
        ]);

        const readBack = await call("GET", `/rest/posts/${enc(urn)}`, { token: access_token });
        expect(await readBack.json()).toMatchObject({ id: urn, author: ORG });

        expect(
            (await call("DELETE", `/rest/posts/${enc(urn)}`, { token: access_token })).status
        ).toBe(204);
        expect((await call("GET", `/rest/posts/${enc(urn)}`, { token: access_token })).status).toBe(
            404
        );
    });

    it("refuses images that were never uploaded, or belong to someone else", async () => {
        const { access_token } = await connect();
        const init = await call("POST", "/rest/images?action=initializeUpload", {
            token: access_token,
            json: { initializeUploadRequest: { owner: ORG } },
        });
        const { value } = (await init.json()) as { value: { image: string } };
        const notUploaded = await call("POST", "/rest/posts", {
            token: access_token,
            json: postBody(ORG, "x", { media: { id: value.image } }),
        });
        expect(notUploaded.status).toBe(422);

        const labsImage = await uploadImage(access_token, LABS);
        const wrongOwner = await call("POST", "/rest/posts", {
            token: access_token,
            json: postBody(ORG, "x", { media: { id: labsImage } }),
        });
        expect(wrongOwner.status).toBe(400);
        expect(await wrongOwner.json()).toMatchObject({ code: "INVALID_VALUE_FOR_FIELD" });
    });

    it("validates the post body like LinkedIn (400 with the field path)", async () => {
        const { access_token } = await connect();
        const body = postBody(ORG, "x") as Record<string, unknown>;
        delete body.lifecycleState;
        const res = await call("POST", "/rest/posts", { token: access_token, json: body });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({
            code: "MISSING_FIELD",
            errorDetails: {
                inputErrors: [{ input: { inputPath: { fieldPath: "/lifecycleState" } } }],
            },
        });
    });

    it("flags reserved little-text characters the client forgot to escape", async () => {
        const { access_token } = await connect();
        await publish(access_token, ORG, "Pricing (beta) is live");
        const post = linkedInSnapshot().posts[0]!;
        expect(post.text).toBe("Pricing (beta) is live");
        expect(post.issues).toHaveLength(2);
        expect(
            renderLittleText("{hashtag|\\#|launch} @[LaunchStack](urn:li:organization:104857)").text
        ).toBe("#launch LaunchStack");
    });

    it("counts a follower per published post", async () => {
        const { access_token } = await connect();
        const size = async () => {
            const res = await call(
                "GET",
                `/rest/networkSizes/${enc(ORG)}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`,
                { token: access_token }
            );
            return ((await res.json()) as { firstDegreeSize: number }).firstDegreeSize;
        };
        expect(await size()).toBe(1284);
        await publish(access_token);
        expect(await size()).toBe(1285);
    });
});

describe("share statistics", () => {
    it("parses List() of encoded URNs, omits quiet posts, and grows with age", async () => {
        const { access_token } = await connect();
        const first = await publish(access_token, ORG, "one");
        advance(10 * 60);
        const second = await publish(access_token, ORG, "two");

        const path = `/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${enc(ORG)}&shares=List(${enc(first)},${enc(second)})`;
        const res = await call("GET", path, { token: access_token });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            elements: {
                share: string;
                organizationalEntity: string;
                totalShareStatistics: Record<string, number>;
            }[];
        };
        // The second post is seconds old: no activity yet, so it is absent.
        expect(body.elements.map(e => e.share)).toEqual([first]);
        const stats = body.elements[0]!.totalShareStatistics;
        expect(stats.impressionCount).toBe(40 + 10 * 7);
        expect(stats.likeCount).toBe(Math.floor(110 * 0.04));
        expect(stats.clickCount).toBe(Math.floor(110 * 0.02));
        // Both seeded comments (20s, 90s) have arrived after ten minutes.
        expect(stats.commentCount).toBe(2);
        expect(stats.engagement).toBeCloseTo((2 + 4 + 2 + 0) / 110, 3);

        advance(5 * 60);
        const later = await call("GET", path, { token: access_token });
        const laterBody = (await later.json()) as typeof body;
        expect(laterBody.elements).toHaveLength(2);
        expect(laterBody.elements[0]!.totalShareStatistics.impressionCount).toBe(40 + 15 * 7);
    });

    it("accepts Rest.li 1.0 shares[0]= and aggregates when no posts are named", async () => {
        const { access_token } = await connect();
        const urn = await publish(access_token);
        advance(120);
        const indexed = await call(
            "GET",
            `/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${enc(ORG)}&shares[0]=${enc(urn)}`,
            { token: access_token }
        );
        expect(((await indexed.json()) as { elements: unknown[] }).elements).toHaveLength(1);

        const lifetime = await call(
            "GET",
            `/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${enc(ORG)}`,
            { token: access_token }
        );
        const body = (await lifetime.json()) as {
            elements: { share?: string; totalShareStatistics: { impressionCount: number } }[];
        };
        expect(body.elements).toHaveLength(1);
        expect(body.elements[0]!.share).toBeUndefined();
        expect(body.elements[0]!.totalShareStatistics.impressionCount).toBe(40 + 14);
    });

    it("is for ADMINISTRATORs only", async () => {
        const { access_token } = await connect();
        const res = await call(
            "GET",
            `/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${enc(LABS)}`,
            { token: access_token }
        );
        expect(res.status).toBe(403);
    });
});

describe("comments", () => {
    type CommentList = {
        paging: { total: number };
        elements: {
            id: string;
            $URN: string;
            commentUrn: string;
            actor: string;
            object: string;
            parentComment?: string;
            message: { text: string };
            created: { time: number };
            "actor~"?: { localizedFirstName: string };
        }[];
    };

    it("seeded comments arrive at +20s and +90s", async () => {
        const { access_token } = await connect();
        const urn = await publish(access_token);
        const list = async () => {
            const res = await call("GET", `/rest/socialActions/${enc(urn)}/comments`, {
                token: access_token,
            });
            expect(res.status).toBe(200);
            return (await res.json()) as CommentList;
        };
        expect((await list()).elements).toHaveLength(0);
        advance(21);
        expect((await list()).elements).toHaveLength(1);
        advance(70);
        const all = await list();
        expect(all.paging.total).toBe(2);
        const first = all.elements[0]!;
        expect(first.actor).toMatch(/^urn:li:person:/);
        expect(first.object).toMatch(/^urn:li:activity:\d+$/);
        expect(first.$URN).toBe(`urn:li:comment:(${first.object},${first.id})`);
        expect(first.commentUrn).toBe(first.$URN);
    });

    it("replies as the Page to a comment, and lists replies by comment URN", async () => {
        const { access_token } = await connect();
        const urn = await publish(access_token);
        advance(30);
        const list = (await (
            await call(
                "GET",
                `/rest/socialActions/${enc(urn)}/comments?projection=(elements*(*,actor~))`,
                {
                    token: access_token,
                }
            )
        ).json()) as CommentList;
        const comment = list.elements[0]!;
        expect(comment["actor~"]?.localizedFirstName).toBeTruthy();

        const reply = await call("POST", `/rest/socialActions/${enc(comment.$URN)}/comments`, {
            token: access_token,
            json: {
                actor: ORG,
                object: urn,
                message: { text: "Thanks — glad it helps!" },
                parentComment: comment.$URN,
            },
        });
        expect(reply.status).toBe(201);
        const created = (await reply.json()) as CommentList["elements"][number];
        expect(reply.headers.get("x-restli-id")).toBe(created.id);
        expect(created).toMatchObject({
            actor: ORG,
            parentComment: comment.$URN,
            message: { text: "Thanks — glad it helps!" },
        });

        const replies = (await (
            await call("GET", `/rest/socialActions/${enc(comment.$URN)}/comments`, {
                token: access_token,
            })
        ).json()) as CommentList;
        expect(replies.elements.map(r => r.id)).toEqual([created.id]);

        // Top-level listing stays top-level.
        const top = (await (
            await call("GET", `/rest/socialActions/${enc(urn)}/comments`, { token: access_token })
        ).json()) as CommentList;
        expect(top.elements.every(e => !e.parentComment)).toBe(true);

        const snapshot = linkedInSnapshot().posts[0]!;
        expect(snapshot.comments[0]!.replies[0]!.text).toBe("Thanks — glad it helps!");
    });

    it("needs a social read scope to list comments", async () => {
        const writer = await connect(["openid", "w_organization_social", "rw_organization_admin"]);
        const urn = await publish(writer.access_token);
        const res = await call("GET", `/rest/socialActions/${enc(urn)}/comments`, {
            token: writer.access_token,
        });
        expect(res.status).toBe(403);
    });
});

describe("page controls", () => {
    it("adds a comment from a fake member and resets the world", async () => {
        const { access_token } = await connect();
        const urn = await publish(access_token);
        const res = await call("POST", "/_standin/action", {
            json: { action: "comment", postUrn: urn, text: "Following!" },
        });
        expect(res.status).toBe(200);
        const snapshot = linkedInSnapshot();
        const added = snapshot.posts[0]!.comments.find(c => c.text === "Following!");
        expect(added?.pending).toBe(false);
        expect(snapshot.tokens.length).toBeGreaterThan(0);
        expect(linkedInWorld().calls.length).toBeGreaterThan(0);

        await call("POST", "/_standin/action", { json: { action: "reset" } });
        expect(linkedInSnapshot().posts).toEqual([]);
        expect(linkedInSnapshot().tokens).toEqual([]);
    });
});
