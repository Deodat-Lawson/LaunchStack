/**
 * The model meter against a real database: concurrent calls add up in one
 * day's row instead of racing, and embeddings and web searches land in rows
 * of their own kind, weighed into chat-token equivalents. What the Usage tab
 * reads back from it — by feature, route, person and kind, priced and
 * unpriced — is usage.integration.test.ts.
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

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb("AI usage meter", () => {
    jest.setTimeout(60_000);
    let companyId: bigint;
    let kindsCompanyId: bigint;
    const today = new Date();
    const date = today.toISOString().slice(0, 10);
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
});
