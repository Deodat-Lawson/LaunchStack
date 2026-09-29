/**
 * Brand posts against a real database: one row per network, limits checked
 * before anything is written, the claim that keeps two schedulers from
 * posting the same thing twice, the due-check, and workspace isolation.
 * Gated like the other integration suites.
 */
import { company } from "@launchstack/store/schema";
import { configureDatabase } from "@launchstack/store/client";
import {
    BrandPostError,
    createBrandPosts,
    deleteBrandPost,
    hasDueBrandPosts,
    listBrandPosts,
    publishBrandPost,
    publishDueBrandPosts,
    updateBrandPost,
} from "@launchstack/pipelines/marketing/posts";
import type { PublishResult } from "@launchstack/tools/social-publish";

import { createFounderWeeklyReviewTestDatabase } from "../../founderWeeklyReview/testDb";

const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;

const ok = (platform: PublishResult["platform"]): PublishResult => ({
    success: true,
    platform,
    postId: `${platform}-1`,
    postUrl: `https://example.invalid/${platform}/1`,
});

describeDb("brand posts persistence", () => {
    jest.setTimeout(120_000);

    let testDb: Awaited<ReturnType<typeof createFounderWeeklyReviewTestDatabase>>;
    let companyA: bigint;
    let companyB: bigint;

    beforeAll(async () => {
        testDb = await createFounderWeeklyReviewTestDatabase();
        configureDatabase(testDb.db);
        const rows = await testDb.db
            .insert(company)
            .values([
                { name: "Roastery A", numberOfEmployees: "5" },
                { name: "Roastery B", numberOfEmployees: "5" },
            ])
            .returning();
        companyA = BigInt(rows[0]!.id);
        companyB = BigInt(rows[1]!.id);
    }, 120_000);

    afterAll(async () => {
        await testDb?.close();
    });

    it("writes one row per network, checks every limit first, and lists by calendar moment", async () => {
        const when = new Date(Date.now() + 3_600_000);
        const posts = await createBrandPosts({
            companyId: companyA,
            userId: "u1",
            platforms: ["linkedin", "bluesky"],
            body: "Why we roast light: the origin stays in the cup.",
            scheduledAt: when,
        });
        expect(posts.map(p => [p.platform, p.status])).toEqual([
            ["linkedin", "scheduled"],
            ["bluesky", "scheduled"],
        ]);
        // One network over its limit means nothing is written for any of them.
        await expect(
            createBrandPosts({
                companyId: companyA,
                userId: "u1",
                platforms: ["linkedin", "x"],
                body: "a".repeat(281),
            })
        ).rejects.toBeInstanceOf(BrandPostError);
        const listed = await listBrandPosts({
            companyId: companyA,
            from: new Date(Date.now() - 60_000),
            to: new Date(Date.now() + 7 * 86_400_000),
        });
        expect(listed).toHaveLength(2);
        // Company B sees nothing of company A.
        expect(await listBrandPosts({ companyId: companyB })).toHaveLength(0);
    });

    it("claims a post once, keeps a failure's reason, and protects what went out", async () => {
        const [post] = await createBrandPosts({
            companyId: companyA,
            userId: "u1",
            platforms: ["bluesky"],
            body: "Sidamo is back on the bar.",
        });
        let calls = 0;
        const publish = async (): Promise<PublishResult> => {
            calls += 1;
            return ok("bluesky");
        };
        const outcomes = await Promise.allSettled([
            publishBrandPost(post!.id, companyA, { publish }),
            publishBrandPost(post!.id, companyA, { publish }),
        ]);
        const fulfilled = outcomes.find(
            (o): o is PromiseFulfilledResult<Awaited<ReturnType<typeof publishBrandPost>>> =>
                o.status === "fulfilled"
        );
        const rejected = outcomes.find((o): o is PromiseRejectedResult => o.status === "rejected");
        expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(1);
        expect(calls).toBe(1);
        expect(rejected?.reason).toMatchObject({ status: 409 });
        expect(fulfilled?.value.status).toBe("published");
        expect(fulfilled?.value.postUrl).toBe("https://example.invalid/bluesky/1");

        await expect(updateBrandPost(post!.id, companyA, { body: "edited" })).rejects.toMatchObject(
            {
                status: 409,
            }
        );
        await expect(deleteBrandPost(post!.id, companyA)).rejects.toMatchObject({ status: 409 });

        const [onX] = await createBrandPosts({
            companyId: companyA,
            userId: "u1",
            platforms: ["x"],
            body: "Short and over to a network that is not connected.",
        });
        const failed = await publishBrandPost(onX!.id, companyA, {
            publish: async () => ({ success: false, platform: "x", error: "X is not connected" }),
        });
        expect(failed.status).toBe("failed");
        expect(failed.error).toBe("X is not connected");
        // A failed post can be edited back to a draft and tried again.
        const retried = await updateBrandPost(onX!.id, companyA, { body: "Second try." });
        expect(retried.status).toBe("draft");
        expect(retried.error).toBeNull();
    });

    it("publishes only what is due, scoped to the workspace, and never a cancelled post", async () => {
        const [due] = await createBrandPosts({
            companyId: companyB,
            userId: "u2",
            platforms: ["bluesky"],
            body: "Due a moment ago.",
            scheduledAt: new Date(Date.now() - 30_000),
        });
        const [later] = await createBrandPosts({
            companyId: companyB,
            userId: "u2",
            platforms: ["bluesky"],
            body: "Tomorrow.",
            scheduledAt: new Date(Date.now() + 86_400_000),
        });
        expect(await hasDueBrandPosts(companyB)).toBe(true);
        expect(await hasDueBrandPosts(companyA)).toBe(false);

        const result = await publishDueBrandPosts({
            companyId: companyB,
            publish: async () => ok("bluesky"),
        });
        expect(result.published.map(p => p.id)).toEqual([due!.id]);
        expect(result.failed).toEqual([]);
        expect(await hasDueBrandPosts(companyB)).toBe(false);

        const cancelled = await updateBrandPost(later!.id, companyB, { status: "cancelled" });
        expect(cancelled.status).toBe("cancelled");
        await expect(
            publishBrandPost(cancelled.id, companyB, { publish: async () => ok("bluesky") })
        ).rejects.toMatchObject({ code: "not_publishable" });
        const rearmed = await updateBrandPost(later!.id, companyB, {
            scheduledAt: new Date(Date.now() + 7_200_000),
        });
        expect(rearmed.status).toBe("scheduled");
    });
});
