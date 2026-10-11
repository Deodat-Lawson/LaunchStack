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
jest.mock("~/server/brand/accounts", () => ({
    BRAND_CONNECTION_PROVIDERS: ["linkedin", "bluesky"],
    listBrandAccounts: (...a: unknown[]) => mockListBrandAccounts(...a),
    listBrandChannels: (...a: unknown[]) => mockListBrandChannels(...a),
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
        publishBrandPost: jest.fn(),
        publishDueBrandPosts: jest.fn(),
    };
});

const mockGetBrandMediaRows = jest.fn();
jest.mock("~/server/brand/media", () => ({
    getBrandMediaRows: (...a: unknown[]) => mockGetBrandMediaRows(...a),
}));
jest.mock("~/server/brand/post-views", () => ({
    toPostViews: (_companyId: bigint, posts: unknown[]) => Promise.resolve(posts),
}));
jest.mock("~/server/brand/publish", () => ({ publishForWorkspace: jest.fn() }));
jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("@launchstack/tools/social-publish/bluesky", () => ({ getBlueskyProfile: jest.fn() }));

import { GET as getAccounts } from "~/app/api/brand/accounts/route";
import { PATCH as patchChannel } from "~/app/api/brand/channels/[id]/route";
import { POST as connectBluesky } from "~/app/api/brand/connections/bluesky/route";
import { DELETE as disconnect } from "~/app/api/brand/connections/[id]/route";
import { POST as refreshConnection } from "~/app/api/brand/connections/[id]/refresh/route";
import { POST as compose } from "~/app/api/brand/posts/route";

function req(path: string, method: string, body?: unknown) {
    return new Request(`https://app.test${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    }) as unknown as Parameters<typeof compose>[0];
}
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });

function as(role: "owner" | "admin" | "member") {
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
    mockGetBrandMediaRows.mockResolvedValue([{ id: "m1" }]);
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
    it("tells a member they cannot manage", async () => {
        as("member");
        mockListBrandAccounts.mockResolvedValue({
            networks: [],
            connections: [],
            channels: [],
            canManage: false,
        });
        const response = await getAccounts();
        expect(response.status).toBe(200);
        expect(mockListBrandAccounts).toHaveBeenCalledWith(BigInt(5), false);
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
