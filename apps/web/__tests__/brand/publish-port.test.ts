/**
 * publishForWorkspace — how a claimed post reaches its network: through the
 * workspace channel's own credential, with its images, and a refused
 * credential turns into "reconnect" instead of a silent retry loop.
 */
import type { BrandPostRecord } from "@launchstack/pipelines/marketing/posts";

const mockPublishToPlatform = jest.fn();
jest.mock("@launchstack/tools/social-publish", () => ({
    publishToPlatform: (...args: unknown[]) => mockPublishToPlatform(...args),
}));

const mockGetChannelRow = jest.fn();
const mockResolveChannelTarget = jest.fn();
const mockMarkConnectionReconnect = jest.fn();
jest.mock("~/server/brand/channels", () => {
    class ChannelUnavailableError extends Error {
        reconnect: boolean;
        constructor(message: string, reconnect: boolean) {
            super(message);
            this.reconnect = reconnect;
        }
    }
    return {
        ChannelUnavailableError,
        getChannelRow: (...a: unknown[]) => mockGetChannelRow(...a),
        resolveChannelTarget: (...a: unknown[]) => mockResolveChannelTarget(...a),
        markConnectionReconnect: (...a: unknown[]) => mockMarkConnectionReconnect(...a),
        refusedSignInReason: () =>
            "LinkedIn no longer accepts this sign-in. Reconnect it under Accounts.",
        NETWORK_LABELS: { linkedin: "LinkedIn", x: "X", bluesky: "Bluesky", reddit: "Reddit" },
        parseDeploymentChannelId: (id: string) =>
            id.startsWith("deployment:") ? id.slice("deployment:".length) : null,
    };
});

const mockMayUseDeploymentAccounts = jest.fn();
jest.mock("~/server/brand/deployment-accounts", () => ({
    mayUseDeploymentAccounts: (...a: unknown[]) => mockMayUseDeploymentAccounts(...a),
    deploymentAccountRefusal: (network: string) =>
        `This server hosts more than one workspace, so its shared ${network} account is not this workspace's to post from.`,
}));

const mockLoadPublishMedia = jest.fn();
jest.mock("~/server/brand/media", () => {
    class BrandMediaError extends Error {}
    return {
        BrandMediaError,
        loadPublishMedia: (...a: unknown[]) => mockLoadPublishMedia(...a),
    };
});

import { ChannelUnavailableError } from "~/server/brand/channels";
import { publishForWorkspace } from "~/server/brand/publish";

function post(overrides: Partial<BrandPostRecord> = {}): BrandPostRecord {
    return {
        id: "p1",
        companyId: BigInt(5),
        createdByUserId: "u1",
        platform: "linkedin",
        body: "We shipped channels.",
        title: null,
        status: "publishing",
        scheduledAt: null,
        publishedAt: null,
        postId: null,
        postUrl: null,
        error: null,
        source: { kind: "compose" },
        createdAt: new Date(),
        updatedAt: null,
        channelId: "ch-page",
        media: [{ id: "m1", alt: "Team photo" }],
        metrics: null,
        metricsAt: null,
        attempts: 0,
        ...overrides,
    };
}

const PAGE = {
    id: "ch-page",
    companyId: BigInt(5),
    connectionId: 9,
    platform: "linkedin",
    kind: "organization",
    externalId: "urn:li:organization:104857",
    name: "LaunchStack",
    status: "active",
};
const IMAGE = { data: new Uint8Array([1, 2, 3]), mimeType: "image/png", alt: "Team photo" };

beforeEach(() => {
    jest.clearAllMocks();
    mockMayUseDeploymentAccounts.mockResolvedValue(true);
    mockLoadPublishMedia.mockResolvedValue([IMAGE]);
    mockGetChannelRow.mockResolvedValue(PAGE);
    mockResolveChannelTarget.mockResolvedValue({
        kind: "linkedin",
        accessToken: "AT",
        authorUrn: PAGE.externalId,
    });
    mockPublishToPlatform.mockResolvedValue({
        success: true,
        platform: "linkedin",
        postId: "urn:li:share:1",
        postUrl: "https://www.linkedin.com/feed/update/urn:li:share:1",
    });
});

it("posts as the Page with the workspace's token and the post's images", async () => {
    const result = await publishForWorkspace(post());
    expect(result.success).toBe(true);
    expect(mockGetChannelRow).toHaveBeenCalledWith(BigInt(5), "ch-page");
    expect(mockPublishToPlatform).toHaveBeenCalledWith({
        platform: "linkedin",
        message: "We shipped channels.",
        title: undefined,
        target: { kind: "linkedin", accessToken: "AT", authorUrn: "urn:li:organization:104857" },
        media: [IMAGE],
    });
});

it("a refused credential marks the connection's channels reconnect and does not retry", async () => {
    mockPublishToPlatform.mockResolvedValue({
        success: false,
        platform: "linkedin",
        error: "LinkedIn 401: REVOKED_ACCESS_TOKEN",
        authFailed: true,
    });
    const result = await publishForWorkspace(post());
    expect(result.success).toBe(false);
    expect(result.retryable).toBeUndefined();
    expect(mockMarkConnectionReconnect).toHaveBeenCalledWith(
        9,
        expect.stringContaining("Reconnect")
    );
    expect(result.error).toContain("no longer accepts this sign-in");
    expect(result.error).toContain("REVOKED_ACCESS_TOKEN");
});

it("an expired sign-in fails before calling the network", async () => {
    mockResolveChannelTarget.mockRejectedValue(
        new ChannelUnavailableError(
            "The LinkedIn sign-in expired. Reconnect to keep posting.",
            true
        )
    );
    const result = await publishForWorkspace(post());
    expect(mockPublishToPlatform).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, authFailed: true, retryable: false });
});

it("a disconnected channel fails with a plain reason", async () => {
    mockGetChannelRow.mockResolvedValue(null);
    const result = await publishForWorkspace(post());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/disconnected/);
    expect(mockPublishToPlatform).not.toHaveBeenCalled();
});

it("legacy and deployment posts use the deployment's keys in the workspace that owns them", async () => {
    await publishForWorkspace(post({ channelId: null, media: [] }));
    await publishForWorkspace(post({ channelId: "deployment:linkedin", media: [] }));
    expect(mockGetChannelRow).not.toHaveBeenCalled();
    for (const call of mockPublishToPlatform.mock.calls)
        expect((call[0] as { target?: unknown }).target).toBeUndefined();
});

it("a workspace that does not own the deployment account never posts through it", async () => {
    // The shared-server case: workspace 5 scheduled on "deployment:x" (or
    // before channels existed), and the operator's X account is not its.
    mockMayUseDeploymentAccounts.mockResolvedValue(false);
    for (const channelId of ["deployment:x", null]) {
        const result = await publishForWorkspace(post({ platform: "x", channelId, media: [] }));
        expect(result).toMatchObject({ success: false, platform: "x" });
        expect(result.error).toMatch(/not this workspace's/);
        // Not a transient failure: retrying would only post as the wrong company later.
        expect(result.retryable).toBeUndefined();
        expect(result.authFailed).toBeUndefined();
    }
    expect(mockMayUseDeploymentAccounts).toHaveBeenCalledWith(BigInt(5));
    expect(mockPublishToPlatform).not.toHaveBeenCalled();
});

it("a workspace's own channel does not depend on owning the deployment account", async () => {
    mockMayUseDeploymentAccounts.mockResolvedValue(false);
    const result = await publishForWorkspace(post());
    expect(result.success).toBe(true);
    expect(mockMayUseDeploymentAccounts).not.toHaveBeenCalled();
});

it("storage being down is worth another try", async () => {
    mockLoadPublishMedia.mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await publishForWorkspace(post());
    expect(result).toMatchObject({ success: false, retryable: true });
});
