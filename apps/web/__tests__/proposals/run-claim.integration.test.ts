/**
 * Run delivery and lazy expiry against real, migrated Postgres. A row lock
 * makes both deliveries reach their first write before either can claim the
 * queued run; model promises control late delivery without clocks or sleeps.
 * Only model/network boundaries and the debit sink are replaced.
 */
import { and, eq, sql } from "drizzle-orm";

import { configureDatabase, createDb, type Db, type DbClient } from "@launchstack/store/client";
import { company } from "@launchstack/store/schema";
import {
    createDefaultPorts,
    executeProposalRun,
    PROPOSAL_CREDITS,
    queueProposalRun,
    type ProposalPorts,
    type RunRecord,
} from "@launchstack/pipelines/proposals";
import { addSection, createApplication, updateSection } from "@launchstack/pipelines/proposals/db";
import { proposalRuns } from "@launchstack/pipelines/proposals/schema";
import type { RunDto } from "~/app/employer/tools/proposals/api";
import { env } from "~/env";
import { debitTokens, TOKEN_SIGNUP_BONUS } from "~/lib/credits";
import {
    tokenAccounts,
    tokenGrants,
    tokenTransactions,
    tokenUsageDaily,
} from "~/server/db/schema/credits";
import { loadRun, loadRuns } from "~/server/proposals/service";
import { createProposalPorts } from "~/server/proposals/ports";

import {
    createFounderWeeklyReviewTestDatabase,
    type FounderWeeklyReviewTestDatabase,
} from "../founderWeeklyReview/testDb";

let mockActiveDb: DbClient | null = null;
jest.mock("~/server/db", () => ({
    get db() {
        if (!mockActiveDb) throw new Error("test database not ready");
        return mockActiveDb;
    },
}));
// Run reads do not publish or dispatch anything. Keep their unused external
// integrations out of this suite, without replacing any run/stage/database code.
jest.mock("~/lib/storage", () => ({
    uploadFile: jest.fn(async () => {
        throw new Error("Unexpected storage upload in run integration test");
    }),
}));
jest.mock("~/server/services/document-upload", () => ({
    processDocumentUpload: jest.fn(async () => {
        throw new Error("Unexpected document upload in run integration test");
    }),
}));
jest.mock("~/server/inngest/client", () => ({
    inngest: {
        send: jest.fn(async () => {
            throw new Error("Unexpected worker dispatch in run integration test");
        }),
    },
}));

const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => {
        resolve = done;
    });
    return { promise, resolve };
}

type Debit = Parameters<NonNullable<ProposalPorts["debitCredits"]>>[0];
type ReadMode = "detail" | "list";

function fixturePorts(
    options: {
        beforeModel?: () => Promise<void>;
        debit?: (args: Debit) => Promise<void>;
    } = {}
) {
    const model = jest.fn(async () => {
        await options.beforeModel?.();
        return {
            draft: "We will expand the community workshop.",
            cites: [],
            gaps: [],
        };
    });
    const debit = jest.fn(async (args: Debit) => {
        await options.debit?.(args);
    });
    const ports: ProposalPorts = {
        ...createDefaultPorts({ enableFetch: false }),
        structured: async (stage, schema) => {
            if (stage !== "rewrite") throw new Error(`Unexpected model stage: ${stage}`);
            return { result: schema.parse(await model()), modelId: "run-claim-fixture" };
        },
        debitCredits: debit,
    };
    return { ports, model, debit };
}

/**
 * Observe actual Postgres lock waiters, not an elapsed delay or a mocked CAS.
 * The observer uses a separate connection from both the holder and executors.
 */
async function waitForRunWriters(observer: DbClient): Promise<void> {
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
        const waiters = await observer.execute(sql`
            SELECT DISTINCT activity.pid
            FROM pg_stat_activity AS activity
            WHERE activity.datname = current_database()
              AND activity.state = 'active'
              AND activity.wait_event_type = 'Lock'
              AND activity.query ILIKE '%proposal_runs%'
        `);
        if (waiters.length >= 2) return;
    }
    throw new Error("Both run deliveries did not reach the Postgres row-lock barrier");
}

/**
 * Only a deadlock watchdog, never a concurrency delay or performance assertion.
 * Real pool I/O cannot use fake timers. Rejection unwinds the held transaction
 * so a query queued on that connection can drain during cleanup.
 */
async function withDebitWatchdog<T>(pending: Promise<T>): Promise<T> {
    let watchdog: NodeJS.Timeout | undefined;
    const deadlock = new Promise<never>((_, reject) => {
        watchdog = setTimeout(() => {
            reject(new Error("Debit is waiting for the connection held by finalization"));
        }, 5_000);
    });
    try {
        return await Promise.race([pending, deadlock]);
    } finally {
        clearTimeout(watchdog);
    }
}

describeDb("proposal run claim and absolute running expiry (integration)", () => {
    jest.setTimeout(120_000);

    let test: FounderWeeklyReviewTestDatabase;
    let executionDb: Db;
    let companyId: bigint;
    let applicationId: string;
    let sectionId: string;
    const userId = "auth_run_claim";
    const ctx = () => ({ companyId, userId });
    const executionCtx = (run: RunRecord) => ({
        ...ctx(),
        runId: run.id,
        scope: { kind: "everything" } as const,
    });

    async function withMeteringDatabase<T>(
        mode: "self-hosted" | "cloud",
        operation: (database: DbClient) => Promise<T>
    ): Promise<T> {
        const url = new URL(
            (process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL)!
        );
        url.pathname = `/${test.databaseName}`;
        const database = createDb({ url: url.toString(), maxConnections: 1 });
        const previousMode = env.server.DEPLOYMENT_MODE;
        env.server.DEPLOYMENT_MODE = mode;
        mockActiveDb = database.db;
        configureDatabase(database.db);
        try {
            return await operation(database.db);
        } finally {
            env.server.DEPLOYMENT_MODE = previousMode;
            mockActiveDb = executionDb.db;
            configureDatabase(executionDb.db);
            await database.close();
        }
    }

    async function meteringState() {
        const [accounts, transactions, daily, grants] = await Promise.all([
            test.db
                .select({
                    balance: tokenAccounts.balanceTokens,
                    used: tokenAccounts.lifetimeTokensUsed,
                    granted: tokenAccounts.lifetimeTokensGranted,
                })
                .from(tokenAccounts)
                .where(eq(tokenAccounts.companyId, companyId)),
            test.db
                .select({
                    type: tokenTransactions.type,
                    amount: tokenTransactions.amount,
                    balanceAfter: tokenTransactions.balanceAfter,
                    service: tokenTransactions.service,
                    referenceId: tokenTransactions.referenceId,
                })
                .from(tokenTransactions)
                .where(eq(tokenTransactions.companyId, companyId))
                .orderBy(tokenTransactions.id),
            test.db
                .select({
                    tokens: tokenUsageDaily.tokensUsed,
                    operations: tokenUsageDaily.operationCount,
                    service: tokenUsageDaily.service,
                })
                .from(tokenUsageDaily)
                .where(eq(tokenUsageDaily.companyId, companyId)),
            test.db
                .select({ amount: tokenGrants.amount, grantType: tokenGrants.grantType })
                .from(tokenGrants)
                .where(eq(tokenGrants.companyId, companyId)),
        ]);
        return { accounts, transactions, daily, grants };
    }

    async function queueRewrite() {
        return queueProposalRun({
            ...ctx(),
            kind: "rewrite",
            input: {
                applicationId,
                sectionIds: [sectionId],
                rewrite: { preset: "plainer" },
            },
        });
    }

    async function readRun(mode: ReadMode, id: string) {
        if (mode === "detail") return loadRun(ctx(), id);
        const run = (await loadRuns(ctx(), applicationId)).find(row => row.id === id);
        if (!run) throw new Error(`Run ${id} missing from service list`);
        return run;
    }

    async function ageRunningRun(run: RunRecord) {
        await test.db
            .update(proposalRuns)
            .set({
                startedAt: new Date(Date.now() - 16 * 60_000),
                // A recent step/update must not reset the absolute startedAt cutoff.
                updatedAt: new Date(),
            })
            .where(and(eq(proposalRuns.id, run.id), eq(proposalRuns.companyId, companyId)));
    }

    beforeAll(async () => {
        test = await createFounderWeeklyReviewTestDatabase();
        const url = new URL(
            (process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL)!
        );
        url.pathname = `/${test.databaseName}`;
        // The shared fixture intentionally has max: 1. Deliveries need a real
        // pool so both can block at the same row lock on separate connections.
        executionDb = createDb({ url: url.toString(), maxConnections: 4 });
        mockActiveDb = executionDb.db;
        configureDatabase(executionDb.db);
    });

    beforeEach(async () => {
        const [workspace] = await test.db
            .insert(company)
            .values({ name: "Run claim regression", numberOfEmployees: "1" })
            .returning({ id: company.id });
        companyId = BigInt(workspace!.id);
        const application = await createApplication({
            companyId,
            createdByUserId: userId,
            title: "Community workshop",
            funder: "Community Fund",
            opportunityId: null,
            deadline: null,
            requestText: null,
            requestUrl: null,
            requestDocumentId: null,
        });
        applicationId = application.id;
        const section = await addSection(companyId, applicationId, {
            key: "plan",
            question: "What will the project do?",
            guidance: null,
            wordLimit: 100,
            required: true,
        });
        sectionId = section.id;
        await updateSection(companyId, sectionId, {
            draft: "We intend to expand the community workshop.",
            status: "drafted",
        });
    });

    afterAll(async () => {
        mockActiveDb = null;
        await executionDb?.close();
        await test?.close();
    });

    it("concurrent deliveries execute the model and debit the same queued run exactly once", async () => {
        const run = await queueRewrite();
        const fixture = fixturePorts();
        const lockSession = await test.createSession();
        const locked = deferred();
        const release = deferred();
        const deliveries: Promise<RunRecord>[] = [];
        const holder = lockSession.db.transaction(async tx => {
            await tx
                .select({ id: proposalRuns.id })
                .from(proposalRuns)
                .where(and(eq(proposalRuns.id, run.id), eq(proposalRuns.companyId, companyId)))
                .for("update");
            locked.resolve();
            await release.promise;
        });
        try {
            await Promise.race([locked.promise, holder]);
            deliveries.push(
                executeProposalRun(executionCtx(run), fixture.ports),
                executeProposalRun(executionCtx(run), fixture.ports)
            );
            await waitForRunWriters(test.db);
        } finally {
            release.resolve();
            await holder;
            await Promise.allSettled(deliveries);
            await lockSession.close();
        }
        await Promise.all(deliveries);
        const completed = await loadRun(ctx(), run.id);

        expect({
            modelCalls: fixture.model.mock.calls.length,
            debits: fixture.debit.mock.calls.map(([args]) => ({
                amount: args.amount,
                referenceId: args.referenceId,
            })),
            status: completed.status,
            credits: completed.credits,
        }).toEqual({
            modelCalls: 1,
            debits: [{ amount: PROPOSAL_CREDITS.rewrite, referenceId: run.id }],
            status: "completed",
            credits: PROPOSAL_CREDITS.rewrite,
        });
        await executeProposalRun(executionCtx(run), fixture.ports);
        expect(fixture.model).toHaveBeenCalledTimes(1);
        expect(fixture.debit).toHaveBeenCalledTimes(1);
    });

    it.each(["detail", "list", "delivery"] as const)(
        "%s expires a run whose startedAt is older than 15 minutes, despite a recent update",
        async mode => {
            const run = await queueRewrite();
            await test.db
                .update(proposalRuns)
                .set({ status: "running" })
                .where(eq(proposalRuns.id, run.id));
            await ageRunningRun(run);
            const fixture = fixturePorts();

            const observed =
                mode === "delivery"
                    ? await executeProposalRun(executionCtx(run), fixture.ports)
                    : await readRun(mode, run.id);
            const persisted = await loadRun(ctx(), run.id);

            expect(observed.status).toBe("failed");
            expect(persisted).toMatchObject({ status: "failed", credits: 0 });
            expect(persisted.error).toBeTruthy();
            expect(persisted.completedAt).not.toBeNull();
            await executeProposalRun(executionCtx(run), fixture.ports);
            expect(await loadRun(ctx(), run.id)).toEqual(persisted);
            expect(fixture.model).not.toHaveBeenCalled();
            expect(fixture.debit).not.toHaveBeenCalled();
        }
    );

    it.each(["detail", "list", "finish"] as const)(
        "a late model result cannot revive or debit an expired run (%s); a fresh run succeeds",
        async mode => {
            const run = await queueRewrite();
            const entered = deferred();
            const release = deferred();
            const fixture = fixturePorts({
                beforeModel: async () => {
                    entered.resolve();
                    await release.promise;
                },
            });
            const execution = executeProposalRun(executionCtx(run), fixture.ports);
            let expired: RunDto | undefined;
            let returned!: RunRecord;
            try {
                await Promise.race([
                    entered.promise,
                    execution.then(result => {
                        throw new Error(
                            `Run ended before model barrier: ${result.status}: ${result.error}`
                        );
                    }),
                ]);
                await ageRunningRun(run);
                if (mode !== "finish") expired = await readRun(mode, run.id);
            } finally {
                release.resolve();
                returned = await execution;
            }
            const after = await loadRun(ctx(), run.id);
            const lateDebits = fixture.debit.mock.calls.map(([args]) => args);
            // Do not rely on a reader having already changed status: "finish"
            // also requires the returning executor to enforce the same cutoff.
            expect({
                readStatus: expired?.status ?? "not read",
                returnedStatus: returned.status,
                persistedStatus: after.status,
                credits: after.credits,
                debits: lateDebits,
            }).toEqual({
                readStatus: mode === "finish" ? "not read" : "failed",
                returnedStatus: "failed",
                persistedStatus: "failed",
                credits: 0,
                debits: [],
            });
            expect(after.error).toBeTruthy();
            expect(after.completedAt).not.toBeNull();
            if (expired) expect(after).toEqual(expired);

            const fresh = await queueRewrite();
            expect(fresh.id).not.toBe(run.id);
            expect(fresh.status).toBe("queued");
            const completed = await executeProposalRun(executionCtx(fresh), fixture.ports);
            expect(completed).toMatchObject({
                status: "completed",
                creditsUsed: PROPOSAL_CREDITS.rewrite,
            });
            expect(fixture.model).toHaveBeenCalledTimes(2);
            expect(fixture.debit.mock.calls.map(([args]) => args)).toEqual([
                expect.objectContaining({
                    referenceId: fresh.id,
                    amount: PROPOSAL_CREDITS.rewrite,
                }),
            ]);
            expect(await loadRun(ctx(), run.id)).toEqual(after);
        }
    );

    it("does not expire queued work or a recently started run because another timestamp is old", async () => {
        const queued = await queueRewrite();
        const running = await queueRewrite();
        const old = new Date(Date.now() - 16 * 60_000);
        await test.db
            .update(proposalRuns)
            .set({ createdAt: old, updatedAt: old })
            .where(eq(proposalRuns.id, queued.id));
        await test.db
            .update(proposalRuns)
            .set({ status: "running", startedAt: new Date(), updatedAt: old })
            .where(eq(proposalRuns.id, running.id));

        expect((await loadRun(ctx(), queued.id)).status).toBe("queued");
        expect((await loadRun(ctx(), running.id)).status).toBe("running");
        const fixture = fixturePorts();
        expect((await executeProposalRun(executionCtx(running), fixture.ports)).status).toBe(
            "running"
        );
        expect(fixture.model).not.toHaveBeenCalled();
        expect(fixture.debit).not.toHaveBeenCalled();
        expect((await executeProposalRun(executionCtx(queued), fixture.ports)).status).toBe(
            "completed"
        );
        expect(fixture.model).toHaveBeenCalledTimes(1);
        expect(fixture.debit).toHaveBeenCalledTimes(1);
    });

    it("does not mark a run completed when the debit sink throws, or retry its debit on redelivery", async () => {
        const run = await queueRewrite();
        const fixture = fixturePorts({
            debit: async () => {
                throw new Error("Credit ledger unavailable");
            },
        });
        const failed = await executeProposalRun(executionCtx(run), fixture.ports);
        expect(failed).toMatchObject({
            status: "failed",
            error: "Credit ledger unavailable",
            creditsUsed: 0,
        });
        expect(await loadRun(ctx(), run.id)).toMatchObject({
            status: "failed",
            error: "Credit ledger unavailable",
            credits: 0,
        });
        await executeProposalRun(executionCtx(run), fixture.ports);
        expect(fixture.model).toHaveBeenCalledTimes(1);
        expect(fixture.debit).toHaveBeenCalledTimes(1);
    });

    it("completes a database-backed debit with a single shared connection", async () => {
        const run = await queueRewrite();
        await test.db.insert(tokenAccounts).values({ companyId, balanceTokens: 10_000 });
        const url = new URL(
            (process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL)!
        );
        url.pathname = `/${test.databaseName}`;
        const singleConnection = createDb({ url: url.toString(), maxConnections: 1 });
        let pendingDebit: Promise<unknown> | undefined;
        const debit = jest.fn(async (args: Debit, transaction?: Pick<DbClient, "update">) => {
            // The optional second argument uses only existing types. Before
            // transaction-aware metering, this uses the very same one-slot
            // pool whose connection finalization is already holding.
            pendingDebit = (transaction ?? singleConnection.db)
                .update(tokenAccounts)
                .set({
                    balanceTokens: sql`${tokenAccounts.balanceTokens} - ${args.amount}`,
                    lifetimeTokensUsed: sql`${tokenAccounts.lifetimeTokensUsed} + ${args.amount}`,
                })
                .where(eq(tokenAccounts.companyId, companyId))
                .returning({ balance: tokenAccounts.balanceTokens })
                .then(rows => {
                    if (rows.length !== 1) throw new Error("The debit account was not found");
                });

            await withDebitWatchdog(pendingDebit);
        });
        const fixture = fixturePorts();
        fixture.ports.debitCredits = debit;
        mockActiveDb = singleConnection.db;
        configureDatabase(singleConnection.db);
        try {
            const completed = await executeProposalRun(executionCtx(run), fixture.ports);
            await pendingDebit;
            expect(completed).toMatchObject({
                status: "completed",
                error: null,
                creditsUsed: PROPOSAL_CREDITS.rewrite,
            });
            expect(fixture.model).toHaveBeenCalledTimes(1);
            expect(debit).toHaveBeenCalledTimes(1);
            const [account] = await test.db
                .select({
                    balance: tokenAccounts.balanceTokens,
                    used: tokenAccounts.lifetimeTokensUsed,
                })
                .from(tokenAccounts)
                .where(eq(tokenAccounts.companyId, companyId));
            expect(account).toEqual({
                balance: 10_000 - PROPOSAL_CREDITS.rewrite,
                used: PROPOSAL_CREDITS.rewrite,
            });
        } finally {
            await pendingDebit?.catch(() => undefined);
            mockActiveDb = executionDb.db;
            configureDatabase(executionDb.db);
            await singleConnection.close();
        }
    });

    it.each([
        { name: "existing account", seed: true, zero: false },
        { name: "missing record-mode account", seed: false, zero: false },
        { name: "zero-amount balance read", seed: true, zero: true },
    ])("uses the actual app meter on one connection ($name)", async ({ seed, zero }) => {
        const run = zero
            ? await queueProposalRun({ ...ctx(), kind: "draft", input: { applicationId } })
            : await queueRewrite();
        if (seed) {
            await test.db.insert(tokenAccounts).values({ companyId, balanceTokens: 10_000 });
        }
        await withMeteringDatabase("self-hosted", async () => {
            const fixture = fixturePorts();
            const meter = createProposalPorts(companyId).debitCredits!;
            let pendingDebit: Promise<void> | undefined;
            fixture.ports.debitCredits = (args, executor) => {
                pendingDebit = meter(args, executor);
                return withDebitWatchdog(pendingDebit);
            };
            try {
                const amount = zero ? 0 : PROPOSAL_CREDITS.rewrite;
                const balance = (seed ? 10_000 : 0) - amount;
                const completed = await executeProposalRun(executionCtx(run), fixture.ports);
                expect(completed).toMatchObject({
                    status: "completed",
                    error: null,
                    creditsUsed: amount,
                });
                await executeProposalRun(executionCtx(run), fixture.ports);
                expect(fixture.model).toHaveBeenCalledTimes(zero ? 0 : 1);
                expect(await meteringState()).toEqual({
                    accounts: [{ balance, used: amount, granted: 0 }],
                    transactions: amount
                        ? [
                              {
                                  type: "debit",
                                  amount: -amount,
                                  balanceAfter: balance,
                                  service: "proposal_writing",
                                  referenceId: run.id,
                              },
                          ]
                        : [],
                    daily: amount
                        ? [{ tokens: amount, operations: 1, service: "proposal_writing" }]
                        : [],
                    grants: [],
                });
            } finally {
                await pendingDebit?.catch(() => undefined);
            }
        });
    });

    it.each([true, false])(
        "rolls the actual app ledger back with finalization (existing account: %s)",
        async seed => {
            const run = await queueRewrite();
            if (seed) {
                await test.db.insert(tokenAccounts).values({ companyId, balanceTokens: 10_000 });
            }
            await withMeteringDatabase("self-hosted", async () => {
                const fixture = fixturePorts();
                const meter = createProposalPorts(companyId).debitCredits!;
                let pendingDebit: Promise<void> | undefined;
                fixture.ports.debitCredits = async (args, executor) => {
                    pendingDebit = meter(args, executor);
                    await withDebitWatchdog(pendingDebit);
                    throw new Error("Rollback after ledger debit");
                };
                try {
                    const failed = await executeProposalRun(executionCtx(run), fixture.ports);
                    expect(failed).toMatchObject({
                        status: "failed",
                        error: "Rollback after ledger debit",
                        creditsUsed: 0,
                    });
                    await executeProposalRun(executionCtx(run), fixture.ports);
                    expect(fixture.model).toHaveBeenCalledTimes(1);
                    expect(await meteringState()).toEqual({
                        accounts: seed ? [{ balance: 10_000, used: 0, granted: 0 }] : [],
                        transactions: [],
                        daily: [],
                        grants: [],
                    });
                } finally {
                    await pendingDebit?.catch(() => undefined);
                }
            });
        }
    );

    it.each([false, true])(
        "keeps cloud signup grants and debit bookkeeping in the supplied transaction (rollback: %s)",
        async rollback => {
            await withMeteringDatabase("cloud", async database => {
                const amount = PROPOSAL_CREDITS.rewrite;
                const balance = TOKEN_SIGNUP_BONUS - amount;
                const referenceId = `cloud-debit-${companyId}`;
                let pendingDebit: Promise<{ newBalance: number } | null> | undefined;
                const operation = database.transaction(async tx => {
                    pendingDebit = debitTokens(
                        {
                            companyId,
                            amount,
                            service: "proposal_writing",
                            description: "Cloud transaction coverage",
                            referenceId,
                            allowNegative: true,
                        },
                        tx
                    );
                    const result = await withDebitWatchdog(pendingDebit);
                    expect(result).toEqual({ newBalance: balance });
                    if (rollback) throw new Error("Rollback cloud grant and debit");
                    return result;
                });
                try {
                    if (rollback) {
                        await expect(operation).rejects.toThrow("Rollback cloud grant and debit");
                    } else {
                        await expect(operation).resolves.toEqual({ newBalance: balance });
                    }
                    expect(await meteringState()).toEqual(
                        rollback
                            ? { accounts: [], transactions: [], daily: [], grants: [] }
                            : {
                                  accounts: [
                                      { balance, used: amount, granted: TOKEN_SIGNUP_BONUS },
                                  ],
                                  transactions: [
                                      {
                                          type: "grant",
                                          amount: TOKEN_SIGNUP_BONUS,
                                          balanceAfter: TOKEN_SIGNUP_BONUS,
                                          service: null,
                                          referenceId: null,
                                      },
                                      {
                                          type: "debit",
                                          amount: -amount,
                                          balanceAfter: balance,
                                          service: "proposal_writing",
                                          referenceId,
                                      },
                                  ],
                                  daily: [
                                      {
                                          tokens: amount,
                                          operations: 1,
                                          service: "proposal_writing",
                                      },
                                  ],
                                  grants: [
                                      { amount: TOKEN_SIGNUP_BONUS, grantType: "signup_bonus" },
                                  ],
                              }
                    );
                } finally {
                    await pendingDebit?.catch(() => undefined);
                }
            });
        }
    );
});
