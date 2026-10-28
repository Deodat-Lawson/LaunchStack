/**
 * The model meter against a real database: concurrent calls add up in one
 * day's row instead of racing. What the Usage tab reads back from it — by
 * feature, route and person, priced and unpriced — is usage.integration.test.ts.
 */
import { eq } from "drizzle-orm";

jest.mock("~/server/engine", () => {
    const databaseUrl = process.env.DATABASE_URL;
    const coreDb = jest.requireActual<{ createDb: typeof createDb }>("@launchstack/store/client");
    const engineDb = databaseUrl
        ? coreDb.createDb({ url: databaseUrl, maxConnections: 5 }).db
        : undefined;
    return { getEngine: jest.fn(() => ({ db: engineDb })) };
});

import type { createDb } from "@launchstack/store/client";
import { company } from "@launchstack/store/schema";

import { recordAiUsage } from "~/server/ai-usage/record";
import { db } from "~/server/db";
import { aiUsageDaily } from "~/server/db/schema";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb("AI usage meter", () => {
    jest.setTimeout(60_000);
    let companyId: bigint;
    const today = new Date();
    const date = today.toISOString().slice(0, 10);

    beforeAll(async () => {
        const [row] = await db
            .insert(company)
            .values({ name: "Usage meter test", numberOfEmployees: "1" })
            .returning({ id: company.id });
        companyId = BigInt(row!.id);
    });

    afterAll(async () => {
        if (companyId) await db.delete(company).where(eq(company.id, Number(companyId)));
    });

    it("adds concurrent calls into one row per feature, route, model and owner", async () => {
        const askCall = {
            route: "default",
            modelId: "vendor/model",
            owner: "deployment" as const,
            inputTokens: 1000,
            outputTokens: 200,
            reasoningTokens: 50,
            cachedInputTokens: 600,
            costUsd: 0.0012345678,
        };
        await Promise.all([
            ...Array.from({ length: 8 }, () => recordAiUsage(companyId, "ask", askCall, today)),
            // Same feature on another route: its own row.
            recordAiUsage(
                companyId,
                "ask",
                { ...askCall, route: "reasoning", costUsd: 0.01 },
                today
            ),
            // No price declared, on the workspace's own endpoint.
            recordAiUsage(
                companyId,
                "ingestion",
                {
                    route: "auxiliary",
                    owner: "workspace",
                    inputTokens: 300,
                    outputTokens: 100,
                },
                today
            ),
            // Nothing reported: not a row.
            recordAiUsage(
                companyId,
                "notes",
                { owner: "deployment", inputTokens: 0, outputTokens: 0 },
                today
            ),
        ]);

        const rows = await db
            .select()
            .from(aiUsageDaily)
            .where(eq(aiUsageDaily.companyId, companyId));
        expect(rows).toHaveLength(3);
        const ask = rows.find(r => r.feature === "ask" && r.route === "default")!;
        expect(ask).toMatchObject({
            date,
            modelId: "vendor/model",
            owner: "deployment",
            calls: 8,
            inputTokens: 8000,
            outputTokens: 1600,
            reasoningTokens: 400,
            cachedInputTokens: 4800,
            pricedCalls: 8,
        });
        expect(Number(ask.costUsd)).toBeCloseTo(8 * 0.0012345678, 9);
    });
});
