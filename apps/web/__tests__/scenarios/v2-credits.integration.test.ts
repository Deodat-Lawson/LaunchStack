/**
 * v2 scenario credit holds on the app's real ledger (token_accounts,
 * token_transactions, token_usage_daily), against a throwaway Postgres
 * database migrated with both sets. Gated like the other database suites on
 * LAUNCHSTACK_TEST_DATABASE_URL / DATABASE_URL (a local server only).
 *
 * What the Usage tab reads must only ever show committed work: a hold moves
 * nothing there, a settled unit is one debit for what it used.
 */
import { randomUUID } from "node:crypto";

import { and, asc, eq, sql } from "drizzle-orm";

import {
    buildInitialPlan,
    CONTRACT_VERSION,
    DEFAULT_POLICIES,
    DEFAULT_SOURCE_BUDGET,
    EMPTY_FLAGS,
    V2_VERSIONS,
    type RequestSpecV2,
} from "@launchstack/pipelines/scenarios/v2";
import {
    acceptRun,
    createV2Store,
    InsufficientCreditsError,
    type AcceptRunInput,
} from "@launchstack/pipelines/scenarios/v2/db";
import {
    scenarioCreditReservations,
    scenarioDispatches,
} from "@launchstack/pipelines/scenarios/schema";
import { configureDatabase } from "@launchstack/store/client";
import { company } from "@launchstack/store/schema";
import { llmChatTokens } from "@launchstack/store/credits";

import { grantTokens } from "~/lib/credits";
import { tokenAccounts, tokenTransactions, tokenUsageDaily } from "~/server/db/schema";
import { createAppScenarioCredits } from "~/server/scenarios/v2/credits";
import { reconcileScenarioRunsV2 } from "~/server/scenarios/v2/dispatch";

import {
    createFounderWeeklyReviewTestDatabase,
    type FounderWeeklyReviewTestDatabase,
} from "../founderWeeklyReview/testDb";

const describeIfDatabase =
    (process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL)
        ? describe
        : describe.skip;

const spec: RequestSpecV2 = {
    contractVersion: CONTRACT_VERSION,
    kind: "scenario",
    title: "Price rise",
    subject: "We raise prices 20% in January.",
    agents: 4,
    rounds: 2,
    seed: 3,
    sources: {
        documentIds: [],
        searchFiles: false,
        prospects: false,
        brandComments: false,
        companyProfile: false,
        notes: "Customers say price drives churn.",
    },
    contextMode: "passage",
    requestedContextMode: "passage",
    fallbackReason: null,
    budget: { maxCredits: 1_000_000, repairsPerUnit: 1 },
    policies: {
        versions: V2_VERSIONS,
        actorTokenCap: DEFAULT_POLICIES.actorTokenCap,
        sourceBudget: DEFAULT_SOURCE_BUDGET,
        castBatchSize: DEFAULT_POLICIES.castBatchSize,
        ingestBatchSize: DEFAULT_POLICIES.ingestBatchSize,
    },
};
const briefCeiling = buildInitialPlan(spec).find(u => u.key === "brief")!.maxCredits;

describeIfDatabase("v2 scenario credits on the workspace ledger", () => {
    jest.setTimeout(180_000);

    let test: FounderWeeklyReviewTestDatabase;
    let companyId: bigint;

    const input = (): AcceptRunInput => ({
        companyId,
        createdByUserId: "creator",
        idempotencyKey: randomUUID(),
        payloadHash: "p".repeat(64),
        spec,
        estimate: { calls: 6, inputTokens: 0, outputTokens: 0, credits: 0 },
        flags: { ...EMPTY_FLAGS },
    });

    const ledgerRows = () =>
        test.db
            .select()
            .from(tokenTransactions)
            .where(eq(tokenTransactions.companyId, companyId))
            .orderBy(asc(tokenTransactions.id));
    const account = async () =>
        (
            await test.db.select().from(tokenAccounts).where(eq(tokenAccounts.companyId, companyId))
        )[0]!;
    const usageDaily = () =>
        test.db
            .select()
            .from(tokenUsageDaily)
            .where(
                and(
                    eq(tokenUsageDaily.companyId, companyId),
                    eq(tokenUsageDaily.service, "scenario_simulation")
                )
            );

    beforeAll(async () => {
        test = await createFounderWeeklyReviewTestDatabase();
        const [row] = await test.db
            .insert(company)
            .values({ name: "v2 credits", numberOfEmployees: "1" })
            .returning({ id: company.id });
        companyId = BigInt(row!.id);
        await grantTokens({ companyId, amount: 100_000, grantType: "manual" }, test.db);
    });

    afterAll(async () => {
        await test?.close();
    });

    it("holds without touching the ledger, then settles one debit and lets the rest go", async () => {
        const credits = createAppScenarioCredits({ enforced: () => true });
        const before = await ledgerRows();
        const accepted = await acceptRun(input(), credits, test.db);

        // The hold is a reservation row only.
        const [hold] = await test.db
            .select()
            .from(scenarioCreditReservations)
            .where(eq(scenarioCreditReservations.runId, accepted.run.id));
        expect(hold).toMatchObject({ unitKey: "brief", status: "held", reserved: briefCeiling });
        expect(await ledgerRows()).toHaveLength(before.length);
        expect((await account()).balanceTokens).toBe(100_000);
        expect((await account()).lifetimeTokensUsed).toBe(0);
        expect(await usageDaily()).toHaveLength(0);

        // Commit the sources unit (nothing used) and the brief (one call).
        const store = createV2Store({ credits, db: test.db });
        const used = llmChatTokens(1_000, 200);
        for (const [key, usage] of [
            ["sources", { calls: 0, inputTokens: 0, outputTokens: 0 }],
            ["brief", { calls: 1, inputTokens: 1_000, outputTokens: 200 }],
        ] as const) {
            const now = new Date();
            const fence = (await store.claimLease(
                accepted.run.id,
                `t:${randomUUID()}`,
                now,
                new Date(now.getTime() + 60_000)
            ))!;
            const unit = (await store.listUnits(accepted.run.id, 1)).find(u => u.key === key)!;
            expect(
                (await store.reserve(fence, { companyId, unitKey: key, amount: unit.maxCredits }))
                    ?.ok
            ).toBe(true);
            const started = (await store.markUnitStarted(fence, unit.id, "h", now))!;
            const ok = await store.commitUnit(fence, {
                unit: started,
                result: { output: null },
                usage,
                credits: llmChatTokens(usage.inputTokens, usage.outputTokens),
                durationMs: 1,
                at: new Date(),
                settlement: { description: `Scenario "Price rise" (${key})` },
            });
            expect(ok).toBe(true);
            await store.releaseLease(fence, null);
        }

        const rows = (await ledgerRows()).slice(before.length);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            type: "debit",
            amount: -used,
            balanceAfter: 100_000 - used,
            service: "scenario_simulation",
            description: 'Scenario "Price rise" (brief)',
            referenceId: `scenario:${accepted.run.id}`,
        });
        expect(rows[0]!.metadata).toMatchObject({
            settlementKey: `scenario:${companyId}:${accepted.run.id}:g1:brief`,
            reserved: briefCeiling,
            unitKey: "brief",
        });
        const after = await account();
        expect(after.balanceTokens).toBe(100_000 - used);
        expect(after.lifetimeTokensUsed).toBe(used);
        expect(await usageDaily()).toEqual([
            expect.objectContaining({ operationCount: 1, tokensUsed: used }),
        ]);
        const settled = await test.db
            .select()
            .from(scenarioCreditReservations)
            .where(
                and(
                    eq(scenarioCreditReservations.runId, accepted.run.id),
                    eq(scenarioCreditReservations.unitKey, "brief")
                )
            );
        expect(settled[0]).toMatchObject({ status: "settled", settled: used });
    });

    it("delivers, through the reconciler, a dispatch the web process never published", async () => {
        configureDatabase(test.db);
        const credits = createAppScenarioCredits({ enforced: () => false });
        // Accepted and committed; the process died before it could publish.
        const accepted = await acceptRun(input(), credits, test.db);
        const published: string[] = [];
        const report = await reconcileScenarioRunsV2({
            now: new Date(Date.now() + 1_000),
            executor: "worker",
            publish: async dispatch => {
                published.push(dispatch.eventId);
            },
        });
        expect(published).toContain(`scenario-run:${accepted.run.id}:g1`);
        expect(report.delivered).toBeGreaterThanOrEqual(1);
        const [row] = await test.db
            .select({ status: scenarioDispatches.status, sentAt: scenarioDispatches.sentAt })
            .from(scenarioDispatches)
            .where(eq(scenarioDispatches.id, accepted.dispatch.id));
        expect(row!.status).toBe("sent");
        expect(row!.sentAt).not.toBeNull();
        // A second pass has nothing left to send for it.
        const again: string[] = [];
        await reconcileScenarioRunsV2({
            now: new Date(Date.now() + 2_000),
            executor: "worker",
            publish: async dispatch => {
                again.push(dispatch.eventId);
            },
        });
        expect(again).not.toContain(`scenario-run:${accepted.run.id}:g1`);
    });

    it("counts other holds against the balance and refuses what it cannot cover", async () => {
        const credits = createAppScenarioCredits({ enforced: () => true });
        // Room for exactly one more brief hold beside the ones already held.
        const [heldRow] = await test.db.execute<{ held: number }>(sql`
            SELECT coalesce(sum(reserved), 0)::int AS held FROM ${scenarioCreditReservations}
            WHERE company_id = ${companyId.toString()}::bigint AND status = 'held'`);
        await test.db
            .update(tokenAccounts)
            .set({ balanceTokens: Number(heldRow?.held ?? 0) + briefCeiling })
            .where(eq(tokenAccounts.companyId, companyId));

        await acceptRun(input(), credits, test.db);
        const refused = await acceptRun(input(), credits, test.db).catch((e: unknown) => e);
        expect(refused).toBeInstanceOf(InsufficientCreditsError);
        expect((refused as InsufficientCreditsError).required).toBe(briefCeiling);
        expect((refused as InsufficientCreditsError).available).toBe(0);

        // Where balances aren't enforced nothing is held, and acceptance always goes ahead.
        const recording = createAppScenarioCredits({ enforced: () => false });
        const accepted = await acceptRun(input(), recording, test.db);
        const [hold] = await test.db
            .select()
            .from(scenarioCreditReservations)
            .where(eq(scenarioCreditReservations.runId, accepted.run.id));
        expect(hold).toMatchObject({ status: "held", reserved: 0 });
    });
});
