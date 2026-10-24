/**
 * The shared-server leak, end to end against a real database: two
 * workspaces, the operator's X keys set, and a post company B scheduled on
 * the deployment's X account before the rule existed. The real scheduler
 * claims it, and the real publish port must refuse it without calling X —
 * then the operator assigns the account and only the named workspace posts.
 * Gated like the other integration suites.
 */
import { company } from "@launchstack/store/schema";
import { configureDatabase } from "@launchstack/store/client";
import type { DbClient } from "@launchstack/store/client";
import {
    createBrandPosts,
    listBrandPosts,
    publishDueBrandPosts,
} from "@launchstack/pipelines/marketing/posts";

import { createFounderWeeklyReviewTestDatabase } from "../../founderWeeklyReview/testDb";

const mockEnv: { server: Record<string, string | undefined> } = { server: {} };
jest.mock("~/env", () => ({
    get env() {
        return mockEnv;
    },
}));

let mockDb: DbClient | null = null;
jest.mock("~/server/db", () => ({
    get db() {
        return mockDb;
    },
}));

const mockPublishToPlatform = jest.fn();
jest.mock("@launchstack/tools/social-publish", () => ({
    publishToPlatform: (...args: unknown[]) => mockPublishToPlatform(...args),
}));
jest.mock("~/server/brand/media", () => ({
    BrandMediaError: class extends Error {},
    loadPublishMedia: () => Promise.resolve([]),
}));
// Only the deployment branch runs here; the stored-channel helpers are unused.
jest.mock("~/server/brand/channels", () => ({
    ChannelUnavailableError: class extends Error {},
    NETWORK_LABELS: { linkedin: "LinkedIn", x: "X", bluesky: "Bluesky", reddit: "Reddit" },
    parseDeploymentChannelId: (id: string) =>
        id.startsWith("deployment:") ? id.slice("deployment:".length) : null,
    getChannelRow: jest.fn(),
    resolveChannelTarget: jest.fn(),
    markConnectionReconnect: jest.fn(),
    refusedSignInReason: jest.fn(),
}));

import { mayUseDeploymentAccounts } from "~/server/brand/deployment-accounts";
import { publishForWorkspace } from "~/server/brand/publish";

const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;

describeDb("deployment social accounts on a shared server", () => {
    jest.setTimeout(120_000);

    let testDb: Awaited<ReturnType<typeof createFounderWeeklyReviewTestDatabase>>;
    let companyA: bigint;
    let companyB: bigint;

    beforeAll(async () => {
        testDb = await createFounderWeeklyReviewTestDatabase();
        configureDatabase(testDb.db);
        mockDb = testDb.db;
    }, 120_000);

    afterAll(async () => {
        await testDb?.close();
    });

    beforeEach(() => {
        mockPublishToPlatform.mockReset();
        mockPublishToPlatform.mockResolvedValue({
            success: true,
            platform: "x",
            postId: "1",
            postUrl: "https://x.com/i/status/1",
        });
        mockEnv.server = {};
    });

    it("a single-workspace install keeps posting through the deployment account", async () => {
        const [a] = await testDb.db
            .insert(company)
            .values({ name: "Roastery A", numberOfEmployees: "5" })
            .returning();
        companyA = BigInt(a!.id);
        expect(await mayUseDeploymentAccounts(companyA)).toBe(true);
    });

    it("once a second workspace exists, a post on the shared X account fails without reaching X", async () => {
        const [b] = await testDb.db
            .insert(company)
            .values({ name: "Roastery B", numberOfEmployees: "5" })
            .returning();
        companyB = BigInt(b!.id);

        // Scheduled on the deployment channel (what compose used to offer every
        // workspace), due a moment ago.
        await createBrandPosts({
            companyId: companyB,
            userId: "u-b",
            targets: [{ platform: "x", channelId: "deployment:x" }],
            body: "Roastery B's new single origin is in.",
            scheduledAt: new Date(Date.now() + 1_000),
        });
        await new Promise(r => setTimeout(r, 1_100));

        await publishDueBrandPosts({ now: new Date(), publish: publishForWorkspace });

        expect(mockPublishToPlatform).not.toHaveBeenCalled();
        const [row] = await listBrandPosts({ companyId: companyB });
        expect(row!.status).toBe("failed");
        expect(row!.error).toMatch(/not this workspace's to post from/);

        expect(await mayUseDeploymentAccounts(companyA)).toBe(false);
        expect(await mayUseDeploymentAccounts(companyB)).toBe(false);
    });

    it("the operator assigns the account to one workspace, and only that one posts", async () => {
        mockEnv.server = { BRAND_DEPLOYMENT_ACCOUNTS_COMPANY_ID: String(companyA) };
        await createBrandPosts({
            companyId: companyA,
            userId: "u-a",
            targets: [{ platform: "x", channelId: "deployment:x" }],
            body: "Roastery A is open late on Fridays.",
            scheduledAt: new Date(Date.now() + 1_000),
        });
        await new Promise(r => setTimeout(r, 1_100));

        await publishDueBrandPosts({ now: new Date(), publish: publishForWorkspace });

        expect(mockPublishToPlatform).toHaveBeenCalledTimes(1);
        expect(mockPublishToPlatform.mock.calls[0]![0]).toMatchObject({
            platform: "x",
            message: "Roastery A is open late on Fridays.",
        });
        const [rowA] = await listBrandPosts({ companyId: companyA });
        expect(rowA!.status).toBe("published");
        expect(await mayUseDeploymentAccounts(companyB)).toBe(false);
    });
});
