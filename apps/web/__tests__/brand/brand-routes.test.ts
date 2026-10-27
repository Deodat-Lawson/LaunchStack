/**
 * /api/brand routes: connecting, disconnecting and switching channels speak
 * for the company on a network, so they take connectors.manage; composing
 * stays open to members but only onto this workspace's own, switched-on,
 * healthy channels. Everything below the routes is stubbed.
 */
import type * as MockRequireWorkspaceContext from "../helpers/mock-require-workspace-context";
import type * as Zod from "zod";

import type { WorkspaceContextResult } from "~/lib/require-workspace-context";

import { makeWorkspaceContext } from "../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn<Promise<WorkspaceContextResult>, []>();
jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

const mockListBrandAccounts = jest.fn();
const mockListBrandChannels = jest.fn();
const mockDefaultChannelFor = jest.fn();
jest.mock("~/server/brand/accounts", () => ({
    BRAND_CONNECTION_PROVIDERS: ["linkedin", "bluesky"],
    NETWORK_LABELS: { linkedin: "LinkedIn", x: "X", bluesky: "Bluesky", reddit: "Reddit" },
    listBrandAccounts: (...a: unknown[]) => mockListBrandAccounts(...a),
    listBrandChannels: (...a: unknown[]) => mockListBrandChannels(...a),
    defaultChannelFor: (...a: unknown[]) => mockDefaultChannelFor(...a),
}));

const mockSetChannelEnabled = jest.fn();
const mockConnectBluesky = jest.fn();
const mockDiscover = jest.fn();
jest.mock("~/server/brand/channels", () => ({
    ChannelUnavailableError: class extends Error {},
    setChannelEnabled: (...a: unknown[]) => mockSetChannelEnabled(...a),
    connectBluesky: (...a: unknown[]) => mockConnectBluesky(...a),
    discoverLinkedInChannels: (...a: unknown[]) => mockDiscover(...a),
    channelsForConnections: jest.fn().mockResolvedValue([]),
    listChannelRows: jest.fn().mockResolvedValue([]),
    parseDeploymentChannelId: (id: string) =>
        id.startsWith("deployment:") ? id.slice("deployment:".length) : null,
}));

const mockGetConnectionById = jest.fn();
const mockDeleteConnection = jest.fn();
jest.mock("~/server/services/connectors/connection-store", () => ({
    getConnectionById: (...a: unknown[]) => mockGetConnectionById(...a),
    deleteConnection: (...a: unknown[]) => mockDeleteConnection(...a),
}));

const mockRevoke = jest.fn();
jest.mock("~/server/services/connectors/config", () => ({
    isConnectorConfigured: () => true,
    getConnectorConfig: () => ({ clientId: "c", clientSecret: "s", redirectUri: "" }),
    PROVIDER_MODULES: { linkedin: { revokeToken: (...a: unknown[]) => mockRevoke(...a) } },
}));

const mockCreateBrandPosts = jest.fn();
const mockPublishBrandPost = jest.fn();
/** Anything that speaks as the company; a refused role must never reach it. */
const mockSpeaks = jest.fn();
jest.mock("@launchstack/pipelines/marketing/posts", () => {
    const { z } = jest.requireActual<typeof Zod>("zod");
    return {
        BRAND_POST_STATUSES: [
            "draft",
            "scheduled",
            "publishing",
            "published",
            "failed",
            "cancelled",
        ],
        MarketingPlatformEnum: z.enum(["x", "linkedin", "bluesky", "reddit"]),
        createBrandPosts: (...a: unknown[]) => mockCreateBrandPosts(...a),
        hasDueBrandPosts: jest.fn().mockResolvedValue(false),
        listBrandPosts: jest.fn().mockResolvedValue([]),
        publishBrandPost: (...a: unknown[]) => mockPublishBrandPost(...a),
        publishDueBrandPosts: (...a: unknown[]) => mockSpeaks("publishDue", ...a),
        updateBrandPost: (...a: unknown[]) => mockSpeaks("update", ...a),
        deleteBrandPost: (...a: unknown[]) => mockSpeaks("delete", ...a),
    };
});

const mockGetBrandMediaRows = jest.fn();
const mockNetworkMediaProblem = jest.fn();
jest.mock("~/server/brand/media", () => ({
    getBrandMediaRows: (...a: unknown[]) => mockGetBrandMediaRows(...a),
    networkMediaProblem: (...a: unknown[]) => mockNetworkMediaProblem(...a),
    saveBrandMedia: (...a: unknown[]) => mockSpeaks("media", ...a),
    toMediaView: (row: unknown) => row,
}));
jest.mock("~/server/brand/comments", () => ({
    replyToComment: (...a: unknown[]) => mockSpeaks("reply", ...a),
    setCommentHandled: (...a: unknown[]) => mockSpeaks("handled", ...a),
}));
jest.mock("~/server/brand/sync", () => ({
    syncBrandWorkspace: (...a: unknown[]) => mockSpeaks("sync", ...a),
}));
const mockMarkContentPublished = jest.fn().mockResolvedValue(undefined);
jest.mock("@launchstack/pipelines/marketing", () => {
    const { z } = jest.requireActual<typeof Zod>("zod");
    return {
        MarketingPlatformEnum: z.enum(["x", "linkedin", "bluesky", "reddit"]),
        markContentPublished: (...a: unknown[]) => mockMarkContentPublished(...a),
    };
});
jest.mock("~/server/brand/post-views", () => ({
    toPostViews: (_companyId: bigint, posts: unknown[]) => Promise.resolve(posts),
}));
jest.mock("~/server/brand/publish", () => ({ publishForWorkspace: jest.fn() }));
const mockClaimGate = jest.fn().mockResolvedValue(null);
jest.mock("~/server/brand/claim-gate", () => ({
    CLAIM_GATE_MESSAGE: "Some claims in this post aren't backed by your documents.",
    claimGate: (...a: unknown[]) => mockClaimGate(...a),
}));
jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("@launchstack/tools/social-publish/bluesky", () => ({ getBlueskyProfile: jest.fn() }));

import { GET as getAccounts } from "~/app/api/brand/accounts/route";
import { PATCH as patchChannel } from "~/app/api/brand/channels/[id]/route";
import { POST as connectBluesky } from "~/app/api/brand/connections/bluesky/route";
import { DELETE as disconnect } from "~/app/api/brand/connections/[id]/route";
import { POST as refreshConnection } from "~/app/api/brand/connections/[id]/refresh/route";
import { POST as compose } from "~/app/api/brand/posts/route";
import { DELETE as deletePost, PATCH as patchPost } from "~/app/api/brand/posts/[id]/route";
import { POST as publishPost } from "~/app/api/brand/posts/[id]/publish/route";
import { POST as publishDue } from "~/app/api/brand/posts/publish-due/route";
import { PATCH as markComment } from "~/app/api/brand/comments/[id]/route";
import { POST as replyComment } from "~/app/api/brand/comments/[id]/reply/route";
import { POST as uploadMedia } from "~/app/api/brand/media/route";
import { POST as syncNow } from "~/app/api/brand/insights/sync/route";
import { POST as campaignPublish } from "~/app/api/marketing-pipeline/publish/route";

function req(path: string, method: string, body?: unknown) {
    return new Request(`https://app.test${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    }) as unknown as Parameters<typeof compose>[0];
}
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });

function as(role: "owner" | "admin" | "member" | "viewer" | "guest") {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ role, companyId: BigInt(5) }),
    });
}

const PAGE = {
    id: "ch-page",
    platform: "linkedin",
    kind: "organization",
    name: "LaunchStack",
    enabled: true,
    status: "active",
    statusReason: null,
    capabilities: { publish: true, images: true, analytics: true, comments: true },
};

beforeEach(() => {
    jest.clearAllMocks();
    mockListBrandChannels.mockResolvedValue([PAGE]);
    mockCreateBrandPosts.mockImplementation((args: { targets: unknown[] }) =>
        Promise.resolve(args.targets.map((t, i) => ({ id: `p${i}`, ...(t as object) })))
    );
    mockGetBrandMediaRows.mockResolvedValue([{ id: "m1", mimeType: "image/png", size: 1000 }]);
    mockNetworkMediaProblem.mockReturnValue(null);
});

describe("account management needs connectors.manage", () => {
    const managed: Array<[string, () => Promise<Response>]> = [
        [
            "PATCH channel",
            () =>
                patchChannel(
                    req("/api/brand/channels/ch-page", "PATCH", { enabled: false }),
                    params({ id: "ch-page" })
                ),
        ],
        [
            "POST bluesky",
            () =>
                connectBluesky(
                    req("/api/brand/connections/bluesky", "POST", {
                        identifier: "acme.bsky.social",
                        appPassword: "abcd-efgh-ijkl-mnop",
                    })
                ),
        ],
        [
            "DELETE connection",
            () => disconnect(req("/api/brand/connections/9", "DELETE"), params({ id: "9" })),
        ],
        [
            "POST refresh",
            () =>
                refreshConnection(
                    req("/api/brand/connections/9/refresh", "POST"),
                    params({ id: "9" })
                ),
        ],
    ];

    it.each(managed)("%s refuses a member", async (_name, call) => {
        as("member");
        const response = await call();
        expect(response.status).toBe(403);
        expect(mockSetChannelEnabled).not.toHaveBeenCalled();
        expect(mockConnectBluesky).not.toHaveBeenCalled();
        expect(mockDeleteConnection).not.toHaveBeenCalled();
        expect(mockDiscover).not.toHaveBeenCalled();
    });

    it("an admin switches a channel in their own workspace", async () => {
        as("admin");
        mockSetChannelEnabled.mockResolvedValue({ id: "ch-page" });
        const response = await patchChannel(
            req("/api/brand/channels/ch-page", "PATCH", { enabled: false }),
            params({ id: "ch-page" })
        );
        expect(response.status).toBe(200);
        expect(mockSetChannelEnabled).toHaveBeenCalledWith(BigInt(5), "ch-page", false);
    });

    it("the deployment's account cannot be switched from a workspace", async () => {
        as("owner");
        const response = await patchChannel(
            req("/api/brand/channels/deployment:x", "PATCH", { enabled: false }),
            params({ id: "deployment:x" })
        );
        expect(response.status).toBe(400);
        expect(mockSetChannelEnabled).not.toHaveBeenCalled();
    });

    it("another workspace's connection is not found, and nothing is deleted", async () => {
        as("owner");
        mockGetConnectionById.mockResolvedValue({
            id: 9,
            companyId: BigInt(99),
            provider: "linkedin",
        });
        const response = await disconnect(
            req("/api/brand/connections/9", "DELETE"),
            params({ id: "9" })
        );
        expect(response.status).toBe(404);
        expect(mockDeleteConnection).not.toHaveBeenCalled();
    });

    it("a non-Brand connection (Slack) is not this route's to delete", async () => {
        as("owner");
        mockGetConnectionById.mockResolvedValue({ id: 9, companyId: BigInt(5), provider: "slack" });
        const response = await disconnect(
            req("/api/brand/connections/9", "DELETE"),
            params({ id: "9" })
        );
        expect(response.status).toBe(404);
        expect(mockDeleteConnection).not.toHaveBeenCalled();
    });

    it("disconnecting LinkedIn deletes the row and revokes the token at LinkedIn", async () => {
        as("owner");
        mockGetConnectionById.mockResolvedValue({
            id: 9,
            companyId: BigInt(5),
            provider: "linkedin",
        });
        mockDeleteConnection.mockResolvedValue({ accessToken: "AT", refreshToken: null });
        mockRevoke.mockResolvedValue(true);
        const response = await disconnect(
            req("/api/brand/connections/9", "DELETE"),
            params({ id: "9" })
        );
        expect(response.status).toBe(200);
        expect(mockDeleteConnection).toHaveBeenCalledWith(9);
        expect(mockRevoke).toHaveBeenCalledWith(expect.anything(), "AT");
        await expect(response.json()).resolves.toMatchObject({ ok: true, revoked: true });
    });
});

describe("GET accounts", () => {
    it("tells a member they cannot manage, and a viewer that they cannot post", async () => {
        as("member");
        mockListBrandAccounts.mockResolvedValue({
            networks: [],
            connections: [],
            channels: [],
            canManage: false,
        });
        const response = await getAccounts(req("/api/brand/accounts", "GET"));
        expect(response.status).toBe(200);
        expect(mockListBrandAccounts).toHaveBeenCalledWith(BigInt(5), false, true, "en");
        as("viewer");
        await getAccounts(req("/api/brand/accounts", "GET"));
        expect(mockListBrandAccounts).toHaveBeenLastCalledWith(BigInt(5), false, false, "en");
    });
});

describe("compose onto channels", () => {
    it("a member posts to the workspace's Page with an image", async () => {
        as("member");
        const response = await compose(
            req("/api/brand/posts", "POST", {
                channels: ["ch-page"],
                body: "Hello",
                media: [{ id: "m1", alt: " Team " }],
                scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
            })
        );
        expect(response.status).toBe(201);
        expect(mockCreateBrandPosts).toHaveBeenCalledWith(
            expect.objectContaining({
                companyId: BigInt(5),
                targets: [{ platform: "linkedin", channelId: "ch-page" }],
                media: [{ id: "m1", alt: "Team" }],
            })
        );
    });

    it("refuses a channel that is not this workspace's", async () => {
        as("member");
        const response = await compose(
            req("/api/brand/posts", "POST", { channels: ["someone-else"], body: "Hi" })
        );
        expect(response.status).toBe(400);
        expect(mockCreateBrandPosts).not.toHaveBeenCalled();
    });

    it("refuses a switched-off channel", async () => {
        as("member");
        mockListBrandChannels.mockResolvedValue([{ ...PAGE, enabled: false }]);
        const response = await compose(
            req("/api/brand/posts", "POST", { channels: ["ch-page"], body: "Hi" })
        );
        expect(response.status).toBe(400);
    });

    it("refuses a channel that needs reconnecting, with its reason", async () => {
        as("member");
        mockListBrandChannels.mockResolvedValue([
            { ...PAGE, status: "reconnect", statusReason: "The LinkedIn sign-in expired." },
        ]);
        const response = await compose(
            req("/api/brand/posts", "POST", { channels: ["ch-page"], body: "Hi" })
        );
        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toMatchObject({
            error: "The LinkedIn sign-in expired.",
        });
    });

    it("refuses an image from another workspace", async () => {
        as("member");
        mockGetBrandMediaRows.mockResolvedValue([]);
        const response = await compose(
            req("/api/brand/posts", "POST", {
                channels: ["ch-page"],
                body: "Hi",
                media: [{ id: "theirs" }],
            })
        );
        expect(response.status).toBe(400);
        expect(mockCreateBrandPosts).not.toHaveBeenCalled();
    });
});

describe("speaking as the company needs social.publish (Viewers and Guests read only)", () => {
    const form = () => {
        const body = new FormData();
        body.set("file", new File([new Uint8Array([1])], "a.png", { type: "image/png" }));
        return new Request("https://app.test/api/brand/media", {
            method: "POST",
            body,
        }) as unknown as Parameters<typeof uploadMedia>[0];
    };
    const writes: Array<[string, () => Promise<Response>]> = [
        [
            "POST posts (compose)",
            () =>
                compose(
                    req("/api/brand/posts", "POST", {
                        channels: ["ch-page"],
                        body: "Hi",
                        publishNow: true,
                    })
                ),
        ],
        [
            "PATCH posts/[id]",
            () =>
                patchPost(req("/api/brand/posts/p1", "PATCH", { body: "x" }), params({ id: "p1" })),
        ],
        [
            "DELETE posts/[id]",
            () => deletePost(req("/api/brand/posts/p1", "DELETE"), params({ id: "p1" })),
        ],
        [
            "POST posts/[id]/publish",
            () => publishPost(req("/api/brand/posts/p1/publish", "POST"), params({ id: "p1" })),
        ],
        ["POST posts/publish-due", () => publishDue(req("/api/brand/posts/publish-due", "POST"))],
        [
            "POST comments/[id]/reply",
            () =>
                replyComment(
                    req("/api/brand/comments/c1/reply", "POST", { text: "Thanks" }),
                    params({ id: "c1" })
                ),
        ],
        [
            "PATCH comments/[id]",
            () =>
                markComment(
                    req("/api/brand/comments/c1", "PATCH", { handled: true }),
                    params({ id: "c1" })
                ),
        ],
        ["POST media", () => uploadMedia(form())],
        ["POST insights/sync", () => syncNow(req("/api/brand/insights/sync", "POST"))],
        [
            "POST marketing-pipeline/publish (campaign)",
            () =>
                campaignPublish(
                    req("/api/marketing-pipeline/publish", "POST", {
                        platform: "linkedin",
                        message: "Hi",
                    })
                ),
        ],
    ];

    it.each(["viewer", "guest"] as const)(
        "a %s is refused everywhere, before anything speaks",
        async role => {
            as(role);
            for (const [name, call] of writes) {
                const response = await call();
                expect([name, response.status]).toEqual([name, 403]);
            }
            expect(mockSpeaks).not.toHaveBeenCalled();
            expect(mockCreateBrandPosts).not.toHaveBeenCalled();
            expect(mockPublishBrandPost).not.toHaveBeenCalled();
        }
    );

    it("a member may reply and mark done", async () => {
        as("member");
        mockSpeaks.mockResolvedValue({ id: "c2" });
        expect(
            (await replyComment(req("/x", "POST", { text: "Thanks" }), params({ id: "c1" }))).status
        ).toBe(201);
        expect(
            (await markComment(req("/x", "PATCH", { handled: true }), params({ id: "c1" }))).status
        ).toBe(200);
    });
});

describe("compose rules on the server", () => {
    it("needs channels; the old per-network form (deployment keys) is gone", async () => {
        as("member");
        const response = await compose(
            req("/api/brand/posts", "POST", { platforms: ["linkedin"], body: "Hi" })
        );
        expect(response.status).toBe(400);
        expect(mockCreateBrandPosts).not.toHaveBeenCalled();
    });

    it("refuses images a chosen network would refuse at publish time", async () => {
        as("member");
        mockNetworkMediaProblem.mockImplementation((platform: string) =>
            platform === "linkedin"
                ? "LinkedIn does not take WebP images. Use JPEG, PNG or GIF."
                : null
        );
        const response = await compose(
            req("/api/brand/posts", "POST", {
                channels: ["ch-page"],
                body: "Hi",
                media: [{ id: "m1" }],
            })
        );
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            error: expect.stringContaining("WebP"),
        });
        expect(mockCreateBrandPosts).not.toHaveBeenCalled();
    });
});

describe("the campaign generator's Publish goes through the workspace's own channel", () => {
    it("posts on the workspace's Page, recorded on the calendar", async () => {
        as("member");
        mockDefaultChannelFor.mockResolvedValue(PAGE);
        mockPublishBrandPost.mockResolvedValue({
            status: "published",
            postId: "urn:li:share:1",
            postUrl: "https://li/1",
            error: null,
        });
        const response = await campaignPublish(
            req("/api/marketing-pipeline/publish", "POST", { platform: "linkedin", message: "Hi" })
        );
        expect(response.status).toBe(200);
        expect(mockDefaultChannelFor).toHaveBeenCalledWith(BigInt(5), "linkedin");
        expect(mockCreateBrandPosts).toHaveBeenCalledWith(
            expect.objectContaining({
                targets: [{ platform: "linkedin", channelId: "ch-page" }],
                source: { kind: "campaign" },
            })
        );
    });

    it("for X and Reddit, says the operator sets them up (they are not connectable here)", async () => {
        as("member");
        mockDefaultChannelFor.mockResolvedValue(null);
        const response = await campaignPublish(
            req("/api/marketing-pipeline/publish", "POST", { platform: "reddit", message: "Hi" })
        );
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            message: expect.stringContaining("set up by the operator"),
        });
    });

    it("says what to connect when nothing can post to the network", async () => {
        as("member");
        mockDefaultChannelFor.mockResolvedValue(null);
        const response = await campaignPublish(
            req("/api/marketing-pipeline/publish", "POST", { platform: "x", message: "Hi" })
        );
        expect(response.status).toBe(400);
        expect(mockCreateBrandPosts).not.toHaveBeenCalled();
    });
});

describe("the claim gate: unbacked claims don't go out as the company unacknowledged", () => {
    const BLOCK = {
        code: "unsupported_claims",
        unavailable: false,
        claims: [
            {
                claim: "We are SOC 2 certified",
                support: "unsupported",
                reason: "The documents only mention plans for an audit.",
                sourceDoc: "Security overview",
            },
        ],
    };

    beforeEach(() => {
        mockDefaultChannelFor.mockResolvedValue(PAGE);
        mockPublishBrandPost.mockResolvedValue({
            status: "published",
            postId: "urn:li:share:1",
            postUrl: "https://li/1",
            error: null,
        });
    });

    it("the generator's Publish answers 409 with the claims, and posts nothing", async () => {
        as("member");
        mockClaimGate.mockResolvedValueOnce(BLOCK);
        const response = await campaignPublish(
            req("/api/marketing-pipeline/publish", "POST", {
                platform: "linkedin",
                message: "We are SOC 2 certified.",
            })
        );
        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toMatchObject({
            code: "unsupported_claims",
            claims: [{ claim: "We are SOC 2 certified", support: "unsupported" }],
        });
        expect(mockClaimGate).toHaveBeenCalledWith(BigInt(5), "We are SOC 2 certified.");
        expect(mockCreateBrandPosts).not.toHaveBeenCalled();
        expect(mockPublishBrandPost).not.toHaveBeenCalled();
    });

    it("a check that could not run blocks the same way (unknown is not clean)", async () => {
        as("member");
        mockClaimGate.mockResolvedValueOnce({ ...BLOCK, unavailable: true, claims: [] });
        const response = await campaignPublish(
            req("/api/marketing-pipeline/publish", "POST", { platform: "linkedin", message: "Hi" })
        );
        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toMatchObject({ unavailable: true });
        expect(mockCreateBrandPosts).not.toHaveBeenCalled();
    });

    it("posts once the member acknowledges, without checking again", async () => {
        as("member");
        const response = await campaignPublish(
            req("/api/marketing-pipeline/publish", "POST", {
                platform: "linkedin",
                message: "We are SOC 2 certified.",
                acknowledgeUnsupportedClaims: true,
            })
        );
        expect(response.status).toBe(200);
        expect(mockClaimGate).not.toHaveBeenCalled();
        expect(mockPublishBrandPost).toHaveBeenCalled();
    });

    it("scheduling a campaign post through Compose is gated too", async () => {
        as("member");
        mockClaimGate.mockResolvedValueOnce(BLOCK);
        const response = await compose(
            req("/api/brand/posts", "POST", {
                channels: ["ch-page"],
                body: "We are SOC 2 certified.",
                scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
                source: { kind: "campaign" },
            })
        );
        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toMatchObject({ code: "unsupported_claims" });
        expect(mockCreateBrandPosts).not.toHaveBeenCalled();
    });

    it("a member's own Compose post is theirs: no claim check", async () => {
        as("member");
        const response = await compose(
            req("/api/brand/posts", "POST", {
                channels: ["ch-page"],
                body: "We are SOC 2 certified.",
                source: { kind: "compose" },
            })
        );
        expect(response.status).toBe(201);
        expect(mockClaimGate).not.toHaveBeenCalled();
    });
});

describe("in the reader's language", () => {
    function zh(path: string, method: string, body?: unknown) {
        return new Request(`https://app.test${path}`, {
            method,
            headers: { "Content-Type": "application/json", cookie: "ls-locale=zh-CN.1" },
            body: body === undefined ? undefined : JSON.stringify(body),
        }) as unknown as Parameters<typeof compose>[0];
    }

    it("refuses a viewer in Chinese, keeping the code", async () => {
        as("viewer");
        const response = await compose(
            zh("/api/brand/posts", "POST", { channels: ["ch-page"], body: "Hello" })
        );
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({
            error: "你的角色可以查看品牌，但不能以公司身份发帖或回复。",
            code: "forbidden",
        });
    });

    it("says a switched-off channel in Chinese, and in English without the cookie", async () => {
        as("member");
        mockListBrandChannels.mockResolvedValue([{ ...PAGE, enabled: false }]);
        const body = { channels: ["ch-page"], body: "Hello" };
        const chinese = await compose(zh("/api/brand/posts", "POST", body));
        expect((await chinese.json()).error).toBe("LaunchStack 已在“账号”中关闭。");
        const english = await compose(req("/api/brand/posts", "POST", body));
        expect((await english.json()).error).toBe("LaunchStack is switched off under Accounts.");
        expect(mockListBrandChannels).toHaveBeenLastCalledWith(BigInt(5), undefined, "en");
    });

    it("words a post error the marketing pipeline threw", async () => {
        as("member");
        const refused = Object.assign(new Error("Pick a time that is still ahead."), {
            status: 400,
            code: "schedule_past",
        });
        mockSpeaks.mockRejectedValue(refused);
        const patch = { scheduledAt: "2020-01-01T00:00:00Z", status: "scheduled" };
        const chinese = await patchPost(
            zh("/api/brand/posts/p1", "PATCH", patch),
            params({ id: "p1" })
        );
        expect(chinese.status).toBe(400);
        expect(await chinese.json()).toEqual({
            error: "请选择一个尚未到来的时间。",
            code: "schedule_past",
        });
        const english = await patchPost(
            req("/api/brand/posts/p1", "PATCH", patch),
            params({ id: "p1" })
        );
        expect((await english.json()).error).toBe("Pick a time that is still ahead.");
    });
});
