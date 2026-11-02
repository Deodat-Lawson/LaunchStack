/**
 * Per-person AI allowances against a real database: calls are counted per
 * person, the workspace limit sums one workspace, the server cap sums every
 * workspace but only the server's own models and keys, embeddings and web
 * searches count in chat-token equivalents and are split out, and an admin's
 * choice for one person overrides the workspace default.
 */
import { eq, inArray } from "drizzle-orm";

import type * as EnvModule from "~/env";

const mockServerEnv: Record<string, string | undefined> = {};
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

import { getAiAllowances, setMemberLimit, unattributedUsage } from "~/server/ai-usage/quota";
import { recordAiUsage } from "~/server/ai-usage/record";
import { db } from "~/server/db";
import { aiUsageDaily, settingsValues, users } from "~/server/db/schema";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb("AI allowances", () => {
    jest.setTimeout(60_000);
    const stamp = Date.now();
    const alice = `allowance-alice-${stamp}`;
    const bob = `allowance-bob-${stamp}`;
    const aliceEmail = `alice-${stamp}@launchstack.test`;
    let workspaceA: bigint;
    let workspaceB: bigint;
    const now = new Date();
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));

    const call = (owner: "deployment" | "workspace", inputTokens: number) => ({
        route: "default",
        modelId: "vendor/model",
        owner,
        inputTokens,
        outputTokens: 0,
    });
    const embedded = (owner: "deployment" | "workspace", modelId: string, inputTokens: number) => ({
        kind: "embedding" as const,
        modelId,
        owner,
        inputTokens,
        outputTokens: 0,
    });
    const searched = (calls: number) => ({
        kind: "web_search" as const,
        calls,
        modelId: "exa",
        owner: "deployment" as const,
        inputTokens: 0,
        outputTokens: 0,
    });

    beforeAll(async () => {
        // A standard chat token at $1.00 per million, so the weights below are exact.
        mockServerEnv.AI_USAGE_CHAT_PRICE_PER_MTOK = "1";
        const rows = await db
            .insert(company)
            .values([
                { name: "Allowance A", numberOfEmployees: "1" },
                { name: "Allowance B", numberOfEmployees: "1" },
            ])
            .returning({ id: company.id });
        workspaceA = BigInt(rows[0]!.id);
        workspaceB = BigInt(rows[1]!.id);
        await db.insert(users).values([
            { name: "Alice", email: aliceEmail, userId: alice, companyId: workspaceA },
            {
                name: "Bob",
                email: `bob-${stamp}@launchstack.test`,
                userId: bob,
                companyId: workspaceA,
            },
        ]);

        await Promise.all([
            // Alice: 600k here on the server's models, 500k in B on the server's,
            // 900k in B on B's own endpoint, and last month's 5M that no longer counts.
            recordAiUsage(workspaceA, "ask", call("deployment", 400_000), now, alice),
            recordAiUsage(workspaceA, "documentWriter", call("deployment", 200_000), now, alice),
            recordAiUsage(workspaceB, "ask", call("deployment", 500_000), now, alice),
            recordAiUsage(workspaceB, "ask", call("workspace", 900_000), now, alice),
            recordAiUsage(workspaceA, "ask", call("deployment", 5_000_000), lastMonth, alice),
            // Alice also embeds 1M tokens here on the server's endpoint ($0.13 =
            // 130k), runs two Exa searches here (7k each = 14k), and embeds 1M
            // in B on B's own endpoint ($0.02 = 20k, B's bill).
            recordAiUsage(
                workspaceA,
                "notes",
                embedded("deployment", "text-embedding-3-large", 1_000_000),
                now,
                alice
            ),
            recordAiUsage(workspaceA, "ask", searched(2), now, alice),
            recordAiUsage(
                workspaceB,
                "ingestion",
                embedded("workspace", "text-embedding-3-small", 1_000_000),
                now,
                alice
            ),
            // Bob: 100k here. Indexing no one started: 50k, and 10k tokens
            // embedded ($0.0013 = 1,300).
            recordAiUsage(workspaceA, "ask", call("deployment", 100_000), now, bob),
            recordAiUsage(workspaceA, "ingestion", call("deployment", 50_000), now),
            recordAiUsage(
                workspaceA,
                "ingestion",
                embedded("deployment", "text-embedding-3-large", 10_000),
                now
            ),
        ]);
        // The workspace default: 1M a month.
        await db.insert(settingsValues).values({
            companyId: workspaceA,
            scopeType: "workspace",
            scopeId: "",
            key: "usage.memberMonthlyTokenLimit",
            value: 1_000_000,
        });
    });

    afterEach(() => {
        for (const key of Object.keys(mockServerEnv)) delete mockServerEnv[key];
        mockServerEnv.AI_USAGE_CHAT_PRICE_PER_MTOK = "1";
    });

    afterAll(async () => {
        await db.delete(users).where(inArray(users.userId, [alice, bob]));
        if (workspaceA) await db.delete(company).where(eq(company.id, Number(workspaceA)));
        if (workspaceB) await db.delete(company).where(eq(company.id, Number(workspaceB)));
    });

    it("records each call against its person", async () => {
        const rows = await db
            .select({
                userId: aiUsageDaily.userId,
                kind: aiUsageDaily.kind,
                inputTokens: aiUsageDaily.inputTokens,
                weightedTokens: aiUsageDaily.weightedTokens,
            })
            .from(aiUsageDaily)
            .where(eq(aiUsageDaily.companyId, workspaceA));
        const chatByPerson = new Map<string, number>();
        const weightedByPerson = new Map<string, number>();
        for (const row of rows) {
            if (row.kind === "chat") {
                chatByPerson.set(row.userId, (chatByPerson.get(row.userId) ?? 0) + row.inputTokens);
            }
            weightedByPerson.set(
                row.userId,
                (weightedByPerson.get(row.userId) ?? 0) + row.weightedTokens
            );
        }
        expect(chatByPerson.get(alice)).toBe(5_600_000);
        expect(chatByPerson.get(bob)).toBe(100_000);
        expect(chatByPerson.get("")).toBe(50_000);
        // Last month's 5M, this month's 600k chat, 130k embedded, 14k searched.
        expect(weightedByPerson.get(alice)).toBe(5_744_000);
        expect(weightedByPerson.get("")).toBe(51_300);
    });

    it("sums this month in this workspace against the workspace default", async () => {
        const allowances = await getAiAllowances(workspaceA, [alice, bob], {
            serverCapApplies: true,
        });
        expect(allowances.get(alice)).toMatchObject({
            used: 744_000,
            split: { chat: 600_000, embedding: 130_000, search: 14_000 },
            workspace: { limit: 1_000_000, source: "default" },
            server: null,
            binding: "workspace",
            percent: 74.4,
            blocked: false,
        });
        expect(allowances.get(bob)).toMatchObject({
            used: 100_000,
            split: { chat: 100_000, embedding: 0, search: 0 },
            percent: 10,
            blocked: false,
        });
    });

    it("sums the server cap across workspaces, on the server's models only", async () => {
        mockServerEnv.AI_MONTHLY_TOKEN_LIMIT_PER_USER = "1000000";
        const allowances = await getAiAllowances(workspaceA, [alice, bob], {
            serverCapApplies: true,
        });
        // 600k here + 500k in B, plus 130k embedded and 14k searched here; B's
        // own-endpoint 900k chat and 20k embedded are B's bill, not the server's.
        expect(allowances.get(alice)).toMatchObject({
            server: {
                limit: 1_000_000,
                used: 1_244_000,
                split: { chat: 1_100_000, embedding: 130_000, search: 14_000 },
            },
            binding: "server",
            blocked: true,
        });
        expect(allowances.get(bob)).toMatchObject({ blocked: false });
    });

    it("skips the server cap for exempt emails and for workspaces on their own models", async () => {
        mockServerEnv.AI_MONTHLY_TOKEN_LIMIT_PER_USER = "1000000";
        mockServerEnv.AI_TOKEN_LIMIT_EXEMPT_EMAILS = aliceEmail.toUpperCase();
        const exempt = await getAiAllowances(workspaceA, [alice], { serverCapApplies: true });
        expect(exempt.get(alice)).toMatchObject({ server: null, blocked: false });

        delete mockServerEnv.AI_TOKEN_LIMIT_EXEMPT_EMAILS;
        const ownModels = await getAiAllowances(workspaceA, [alice], { serverCapApplies: false });
        expect(ownModels.get(alice)).toMatchObject({ server: null, blocked: false });
    });

    it("lets an admin's choice for one person override the default", async () => {
        const previous = await setMemberLimit(
            workspaceA,
            bob,
            { mode: "custom", monthlyTokens: 50_000 },
            alice
        );
        expect(previous).toEqual({ mode: "default" });
        let bobs = await getAiAllowances(workspaceA, [bob], { serverCapApplies: true });
        expect(bobs.get(bob)).toMatchObject({
            workspace: { limit: 50_000, source: "member" },
            percent: 200,
            blocked: true,
        });

        await setMemberLimit(workspaceA, bob, { mode: "none" }, alice);
        bobs = await getAiAllowances(workspaceA, [bob], { serverCapApplies: true });
        expect(bobs.get(bob)).toMatchObject({
            workspace: { limit: null, source: "member" },
            blocked: false,
        });

        const back = await setMemberLimit(workspaceA, bob, { mode: "default" }, alice);
        expect(back).toEqual({ mode: "none" });
        bobs = await getAiAllowances(workspaceA, [bob], { serverCapApplies: true });
        expect(bobs.get(bob)?.workspace).toEqual({ limit: 1_000_000, source: "default" });
    });

    it("counts a workspace's own embedding against that workspace, not the server", async () => {
        mockServerEnv.AI_MONTHLY_TOKEN_LIMIT_PER_USER = "1000000";
        const inB = await getAiAllowances(workspaceB, [alice], { serverCapApplies: true });
        expect(inB.get(alice)).toMatchObject({
            used: 1_420_000,
            split: { chat: 1_400_000, embedding: 20_000, search: 0 },
            server: { used: 1_244_000 },
        });
    });

    it("reports this month's usage no one person started", async () => {
        // 50k chat and 1,300 for the 10k tokens embedded.
        await expect(unattributedUsage(workspaceA)).resolves.toBe(51_300);
    });
});
