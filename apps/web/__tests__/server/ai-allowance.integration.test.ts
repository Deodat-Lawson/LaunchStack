/**
 * Per-person AI allowances against a real database: calls are counted per
 * person, the workspace limit sums one workspace, the server cap sums every
 * workspace but only the server's own models, and an admin's choice for one
 * person overrides the workspace default.
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

    beforeAll(async () => {
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
            // Bob: 100k here. Indexing no one started: 50k.
            recordAiUsage(workspaceA, "ask", call("deployment", 100_000), now, bob),
            recordAiUsage(workspaceA, "ingestion", call("deployment", 50_000), now),
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
    });

    afterAll(async () => {
        await db.delete(users).where(inArray(users.userId, [alice, bob]));
        if (workspaceA) await db.delete(company).where(eq(company.id, Number(workspaceA)));
        if (workspaceB) await db.delete(company).where(eq(company.id, Number(workspaceB)));
    });

    it("records each call against its person", async () => {
        const rows = await db
            .select({ userId: aiUsageDaily.userId, inputTokens: aiUsageDaily.inputTokens })
            .from(aiUsageDaily)
            .where(eq(aiUsageDaily.companyId, workspaceA));
        const byPerson = new Map<string, number>();
        for (const row of rows) {
            byPerson.set(row.userId, (byPerson.get(row.userId) ?? 0) + row.inputTokens);
        }
        expect(byPerson.get(alice)).toBe(5_600_000);
        expect(byPerson.get(bob)).toBe(100_000);
        expect(byPerson.get("")).toBe(50_000);
    });

    it("sums this month in this workspace against the workspace default", async () => {
        const allowances = await getAiAllowances(workspaceA, [alice, bob], {
            serverCapApplies: true,
        });
        expect(allowances.get(alice)).toMatchObject({
            used: 600_000,
            workspace: { limit: 1_000_000, source: "default" },
            server: null,
            binding: "workspace",
            percent: 60,
            blocked: false,
        });
        expect(allowances.get(bob)).toMatchObject({ used: 100_000, percent: 10, blocked: false });
    });

    it("sums the server cap across workspaces, on the server's models only", async () => {
        mockServerEnv.AI_MONTHLY_TOKEN_LIMIT_PER_USER = "1000000";
        const allowances = await getAiAllowances(workspaceA, [alice, bob], {
            serverCapApplies: true,
        });
        // 600k here + 500k in B; B's own-endpoint 900k is B's bill, not the server's.
        expect(allowances.get(alice)).toMatchObject({
            server: { limit: 1_000_000, used: 1_100_000 },
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

    it("reports this month's usage no one person started", async () => {
        await expect(unattributedUsage(workspaceA)).resolves.toBe(50_000);
    });
});
