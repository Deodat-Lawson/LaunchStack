/**
 * The model meter against a real database: concurrent calls add up in one
 * day's row instead of racing, and the usage page's figures — by feature, by
 * route, by kind (chat, embeddings, web search), in chat-token equivalents,
 * priced and unpriced cost — come back from what was recorded.
 */
import { eq } from "drizzle-orm";

import type * as EnvModule from "~/env";

// A standard chat token pinned at $1.00 per million, whatever model file the
// suite runs next to, so the weights below are exact.
const mockServerEnv: Record<string, string | undefined> = { AI_USAGE_CHAT_PRICE_PER_MTOK: "1" };
jest.mock("~/env", () => {
    const actual = jest.requireActual<typeof EnvModule>("~/env");
    return {
        env: {
            ...actual.env,
            server: new Proxy(actual.env.server, {
                get: (target, key: string) =>
                    key in mockServerEnv ? mockServerEnv[key] : target[key as keyof typeof target],
            }),
        },
    };
});

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
import { modelUsageOverview } from "~/server/settings/usage";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb("AI usage meter", () => {
    jest.setTimeout(60_000);
    let companyId: bigint;
    let kindsCompanyId: bigint;
    const today = new Date();
    const date = today.toISOString().slice(0, 10);
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    // With no search in the window, the page quotes the configured provider's rate.
    const searchKeys = ["EXA_API_KEY", "SERPER_API_KEY", "SEARCH_PROVIDER"] as const;
    const savedSearchKeys = new Map<string, string | undefined>();

    beforeAll(async () => {
        for (const key of searchKeys) {
            savedSearchKeys.set(key, process.env[key]);
            delete process.env[key];
        }
        const rows = await db
            .insert(company)
            .values([
                { name: "Usage meter test", numberOfEmployees: "1" },
                { name: "Usage kinds test", numberOfEmployees: "1" },
            ])
            .returning({ id: company.id });
        companyId = BigInt(rows[0]!.id);
        kindsCompanyId = BigInt(rows[1]!.id);
    });

    afterAll(async () => {
        for (const [key, value] of savedSearchKeys) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        if (companyId) await db.delete(company).where(eq(company.id, Number(companyId)));
        if (kindsCompanyId) {
            await db.delete(company).where(eq(company.id, Number(kindsCompanyId)));
        }
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
            kind: "chat",
            weightedTokens: 8 * 1200,
            calls: 8,
            inputTokens: 8000,
            outputTokens: 1600,
            reasoningTokens: 400,
            cachedInputTokens: 4800,
            pricedCalls: 8,
        });
        expect(Number(ask.costUsd)).toBeCloseTo(8 * 0.0012345678, 9);
    });

    it("totals the window by feature and route, with priced cost and the workspace's fallback", async () => {
        const unpriced = await modelUsageOverview(companyId, since, 0);
        expect(unpriced.totals).toMatchObject({
            calls: 10,
            weightedTokens: 11200,
            inputTokens: 9300,
            outputTokens: 1900,
            pricedCalls: 9,
        });
        expect(unpriced.byGroup.map(g => [g.group, g.calls, g.weightedTokens])).toEqual([
            ["chat", 10, 11200],
            ["embedding", 0, 0],
            ["search", 0, 0],
        ]);
        // Nothing embedded or searched in the window: today's rates for the defaults.
        expect(unpriced.rates).toEqual({
            chat: { perMillion: 1, source: "setting" },
            embeddingPerMillion: 130_000,
            perSearch: 7_000,
        });
        expect(unpriced.totals.costUsd).toBeCloseTo(8 * 0.0012345678 + 0.01, 9);
        expect(unpriced.estimatedCostUsd).toBeCloseTo(unpriced.totals.costUsd, 9);
        expect(unpriced.byFeature.map(f => f.feature)).toEqual(["ask", "ingestion"]);
        expect(unpriced.byRoute.map(r => [r.route, r.calls])).toEqual([
            ["default", 8],
            ["reasoning", 1],
            ["auxiliary", 1],
        ]);
        expect(unpriced.workspaceOwnedCalls).toBe(1);
        expect(unpriced.daily).toEqual([
            { date, features: { ask: 10800, ingestion: 400 }, total: 11200 },
        ]);

        // The unpriced call's 400 tokens at the workspace's own $2 per 1M.
        const fallback = await modelUsageOverview(companyId, since, 2);
        expect(fallback.estimatedCostUsd).toBeCloseTo(
            unpriced.totals.costUsd + (400 / 1_000_000) * 2,
            9
        );
    });

    it("keeps embeddings and searches in their own rows, weighed into chat-token equivalents", async () => {
        const ws = kindsCompanyId;
        await Promise.all([
            // One chat call: 1,200 tokens, priced.
            recordAiUsage(
                ws,
                "ask",
                {
                    route: "default",
                    modelId: "vendor/model",
                    owner: "deployment",
                    inputTokens: 1000,
                    outputTokens: 200,
                    costUsd: 0.001,
                },
                today
            ),
            // Two embedding batches on the deployment's endpoint: 500k tokens at
            // $0.13 per 1M = $0.065 = 65,000.
            ...[0, 1].map(() =>
                recordAiUsage(
                    ws,
                    "ingestion",
                    {
                        kind: "embedding",
                        modelId: "text-embedding-3-large",
                        owner: "deployment",
                        inputTokens: 250_000,
                        outputTokens: 0,
                    },
                    today
                )
            ),
            // 1M on the workspace's own endpoint at $0.02: 20,000, its own bill.
            recordAiUsage(
                ws,
                "ingestion",
                {
                    kind: "embedding",
                    modelId: "openai/text-embedding-3-small",
                    owner: "workspace",
                    inputTokens: 1_000_000,
                    outputTokens: 0,
                },
                today
            ),
            // Three Exa searches (7,000 each), one Serper (1,000), and four
            // pages Exa read (2,000 each) on the same feature, route, model,
            // owner and person as the Exa searches: only the kind tells them apart.
            ...[0, 1, 2].map(() =>
                recordAiUsage(
                    ws,
                    "ask",
                    {
                        kind: "web_search",
                        calls: 1,
                        modelId: "exa",
                        owner: "deployment",
                        inputTokens: 0,
                        outputTokens: 0,
                    },
                    today
                )
            ),
            recordAiUsage(
                ws,
                "ask",
                {
                    kind: "web_search",
                    modelId: "serper",
                    owner: "deployment",
                    inputTokens: 0,
                    outputTokens: 0,
                },
                today
            ),
            recordAiUsage(
                ws,
                "ask",
                {
                    kind: "web_contents",
                    calls: 4,
                    modelId: "exa",
                    owner: "deployment",
                    inputTokens: 0,
                    outputTokens: 0,
                },
                today
            ),
            // Nothing used: no row.
            recordAiUsage(
                ws,
                "ask",
                {
                    kind: "web_search",
                    calls: 0,
                    modelId: "exa",
                    owner: "deployment",
                    inputTokens: 0,
                    outputTokens: 0,
                },
                today
            ),
            recordAiUsage(
                ws,
                "notes",
                {
                    kind: "embedding",
                    modelId: "text-embedding-3-large",
                    owner: "deployment",
                    inputTokens: 0,
                    outputTokens: 0,
                },
                today
            ),
        ]);

        const rows = await db.select().from(aiUsageDaily).where(eq(aiUsageDaily.companyId, ws));
        expect(rows.map(r => [r.kind, r.modelId, r.owner]).sort()).toEqual(
            [
                ["chat", "vendor/model", "deployment"],
                ["embedding", "openai/text-embedding-3-small", "workspace"],
                ["embedding", "text-embedding-3-large", "deployment"],
                ["web_contents", "exa", "deployment"],
                ["web_search", "exa", "deployment"],
                ["web_search", "serper", "deployment"],
            ].sort()
        );
        const of = (kind: string, modelId: string) =>
            rows.find(r => r.kind === kind && r.modelId === modelId)!;

        const embedded = of("embedding", "text-embedding-3-large");
        expect(embedded).toMatchObject({
            calls: 2,
            inputTokens: 500_000,
            outputTokens: 0,
            weightedTokens: 65_000,
            pricedCalls: 2,
        });
        expect(Number(embedded.costUsd)).toBeCloseTo(0.065, 9);
        expect(of("embedding", "openai/text-embedding-3-small")).toMatchObject({
            weightedTokens: 20_000,
            pricedCalls: 0,
            costUsd: "0.0000000000",
        });
        const searches = of("web_search", "exa");
        expect(searches).toMatchObject({
            feature: "ask",
            route: "",
            calls: 3,
            inputTokens: 0,
            outputTokens: 0,
            weightedTokens: 21_000,
            pricedCalls: 3,
        });
        expect(Number(searches.costUsd)).toBeCloseTo(0.021, 9);
        expect(of("web_contents", "exa")).toMatchObject({
            feature: "ask",
            route: "",
            calls: 4,
            weightedTokens: 8_000,
        });
    });

    it("totals every kind in chat-token equivalents, with each group's own units", async () => {
        const usage = await modelUsageOverview(kindsCompanyId, since, 0);

        // 1,200 chat + 85,000 embedding + 30,000 search.
        expect(usage.totals).toMatchObject({
            calls: 12,
            weightedTokens: 116_200,
            inputTokens: 1_501_000,
            outputTokens: 200,
            pricedCalls: 11,
        });
        expect(usage.totals.costUsd).toBeCloseTo(0.001 + 0.065 + 0.021 + 0.001 + 0.008, 9);
        expect(usage.byGroup).toEqual([
            expect.objectContaining({
                group: "chat",
                calls: 1,
                weightedTokens: 1_200,
                searches: 0,
                pages: 0,
            }),
            expect.objectContaining({
                group: "embedding",
                calls: 3,
                weightedTokens: 85_000,
                inputTokens: 1_500_000,
                searches: 0,
                pages: 0,
            }),
            expect.objectContaining({
                group: "search",
                calls: 8,
                weightedTokens: 30_000,
                inputTokens: 0,
                searches: 4,
                pages: 4,
            }),
        ]);
        // The rates the window was weighed at: 85,000 over 1.5M embedded, and
        // 22,000 over four searches (pages are not searches).
        expect(usage.rates).toEqual({
            chat: { perMillion: 1, source: "setting" },
            embeddingPerMillion: 56_667,
            perSearch: 5_500,
        });
        // Routes are chat's alone; searches and embeddings carry none.
        expect(usage.byRoute.map(r => [r.route, r.calls, r.weightedTokens])).toEqual([
            ["default", 1, 1_200],
        ]);
        expect(usage.byFeature.map(f => [f.feature, f.weightedTokens])).toEqual([
            ["ingestion", 85_000],
            ["ask", 31_200],
        ]);
        expect(usage.daily).toEqual([
            { date, features: { ingestion: 85_000, ask: 31_200 }, total: 116_200 },
        ]);
        expect(usage.workspaceOwnedCalls).toBe(1);
        expect(usage.estimatedCostUsd).toBeCloseTo(usage.totals.costUsd, 9);

        // The workspace-owned embedding is the only unpriced row: its 20,000
        // chat-token equivalents at the workspace's own $2 per 1M.
        const fallback = await modelUsageOverview(kindsCompanyId, since, 2);
        expect(fallback.estimatedCostUsd).toBeCloseTo(
            usage.totals.costUsd + (20_000 / 1_000_000) * 2,
            9
        );
    });

    it("reports no cost when nothing in the window could be priced", async () => {
        const later = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
        const empty = await modelUsageOverview(companyId, later, 0);
        expect(empty.totals.calls).toBe(0);
        expect(empty.estimatedCostUsd).toBeNull();
    });
});
