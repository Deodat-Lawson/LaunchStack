/**
 * The outbox claim runs as raw SQL, so it has to be exercised against a real
 * database — a mocked query builder would prove nothing about SKIP LOCKED,
 * the CTE, or the snake_case row mapping.
 */

import { sql } from "drizzle-orm";

import { createFounderWeeklyReviewTestDatabase } from "./testDb";

const describeIfDatabase =
    (process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL)
        ? describe
        : describe.skip;

type TestDatabase = Awaited<ReturnType<typeof createFounderWeeklyReviewTestDatabase>>;

describeIfDatabase("founder weekly review dispatch claiming", () => {
    jest.setTimeout(120_000);

    let testDb: TestDatabase;
    let claimPendingDispatches: typeof import("~/server/founder-weekly-review/dispatch-service").claimPendingDispatches;
    let recordDispatchFailure: typeof import("~/server/founder-weekly-review/dispatch-service").recordDispatchFailure;
    let MAX_DISPATCH_ATTEMPTS: number;

    beforeAll(async () => {
        testDb = await createFounderWeeklyReviewTestDatabase();
        // The service binds `db` at import time, so the test database has to be
        // installed before the module is first required.
        jest.doMock("~/server/db", () => ({ db: testDb.db }));
        ({ claimPendingDispatches, recordDispatchFailure, MAX_DISPATCH_ATTEMPTS } = await import(
            "~/server/founder-weekly-review/dispatch-service"
        ));

        await testDb.db.execute(sql`
            INSERT INTO "pdr_ai_v2_company" ("name", "numberOfEmployees")
            VALUES ('Dispatch Co', '3')
        `);
        await testDb.db.execute(sql`
            INSERT INTO "pdr_ai_v2_founder_weekly_review_runs"
                ("id", "company_id", "request_key", "reporting_period_start",
                 "reporting_period_end", "status", "review_schema_version",
                 "evidence_schema_version", "collection_input", "created_by_actor_id")
            VALUES ('fwr_dispatch', 1, 'k', DATE '2026-07-07', DATE '2026-07-13',
                    'queued', 'founder-weekly-review/v1',
                    'founder-weekly-review-evidence/v1',
                    '{"workspaceTimezone":"UTC","actorExternalUserId":"u"}'::jsonb,
                    'user:u')
        `);
    });

    afterAll(async () => {
        await testDb?.close();
        jest.dontMock("~/server/db");
    });

    async function insertDispatch(
        id: string,
        availableAtIso: string,
        status = "pending"
    ): Promise<void> {
        await testDb.db.execute(sql`
            INSERT INTO "pdr_ai_v2_founder_weekly_review_dispatches"
                ("id", "company_id", "run_id", "operation_type", "operation_key",
                 "event_id", "generation_job_id", "generation_claim_id",
                 "status", "available_at")
            VALUES (${id}, 1, 'fwr_dispatch', 'create', ${id},
                    ${`event-${id}`}, ${`job-${id}`}, ${`claim-${id}`},
                    ${status}, ${availableAtIso})
        `);
    }

    it("claims due rows oldest-first and maps every column back", async () => {
        await insertDispatch("d_second", "2026-07-02T00:00:00.000Z");
        await insertDispatch("d_first", "2026-07-01T00:00:00.000Z");
        // Not due yet — must be left alone even though the batch has room.
        await insertDispatch("d_future", "2099-01-01T00:00:00.000Z");

        const claimed = await claimPendingDispatches(10);

        expect(claimed.map(d => d.id)).toEqual(["d_first", "d_second"]);
        // Raw SQL returns database column names and untyped numerics; the
        // mapper is what turns them back into the domain shape.
        expect(claimed[0]).toMatchObject({
            id: "d_first",
            companyId: 1n,
            runId: "fwr_dispatch",
            operationType: "create",
            operationKey: "d_first",
            eventId: "event-d_first",
            generationJobId: "job-d_first",
            generationClaimId: "claim-d_first",
            status: "dispatching",
            attemptCount: 1,
        });
        expect(claimed[0]?.availableAt).toBeInstanceOf(Date);
    });

    it("does not hand the same row to a second claimer", async () => {
        // The first call already moved both due rows to 'dispatching' with a
        // fresh updated_at, so they are neither pending nor stale.
        expect(await claimPendingDispatches(10)).toEqual([]);
    });

    it("reclaims a dispatching row that has gone stale", async () => {
        await testDb.db.execute(sql`
            UPDATE "pdr_ai_v2_founder_weekly_review_dispatches"
            SET "updated_at" = now() - interval '10 minutes'
            WHERE "id" = 'd_first'
        `);

        const claimed = await claimPendingDispatches(10);
        expect(claimed.map(d => d.id)).toEqual(["d_first"]);
        // Reclaiming counts as another attempt.
        expect(claimed[0]?.attemptCount).toBe(2);
    });

    it("honours the batch limit", async () => {
        await testDb.db.execute(sql`
            UPDATE "pdr_ai_v2_founder_weekly_review_dispatches"
            SET "status" = 'pending', "updated_at" = now()
            WHERE "id" IN ('d_first', 'd_second')
        `);

        const claimed = await claimPendingDispatches(1);
        expect(claimed).toHaveLength(1);
    });

    describe("when every send in a batch fails", () => {
        async function statusOf(id: string) {
            const rows = await testDb.db.execute<{
                status: string;
                attempt_count: number | string;
                available_at: Date | string;
            }>(sql`
                SELECT "status", "attempt_count", "available_at"
                FROM "pdr_ai_v2_founder_weekly_review_dispatches"
                WHERE "id" = ${id}
            `);
            const row = [...rows][0]!;
            return {
                status: row.status,
                attemptCount: Number(row.attempt_count),
                availableAt: new Date(row.available_at as string),
            };
        }

        /**
         * These cases own their rows. Everything else in this file is parked
         * with `available_at` far in the future so a claim here can only ever
         * return the row under test.
         */
        beforeAll(async () => {
            await testDb.db.execute(sql`
                UPDATE "pdr_ai_v2_founder_weekly_review_dispatches"
                SET "status" = 'dispatched', "available_at" = now() + interval '10 years'
            `);
        });

        /**
         * Due a minute ago, not "now". The claim compares available_at against
         * a timestamp taken in the Node process, while `now()` here is the
         * database's clock — in CI those are different containers, and a few
         * milliseconds of skew is enough to make a row that should be due read
         * as not-yet-due. Backdating removes the race from the fixture.
         */
        async function freshRow(id: string, attemptCount = 0): Promise<void> {
            await insertDispatch(id, new Date(Date.now() - 60_000).toISOString());
            await testDb.db.execute(sql`
                UPDATE "pdr_ai_v2_founder_weekly_review_dispatches"
                SET "attempt_count" = ${attemptCount}
                WHERE "id" = ${id}
            `);
        }

        it("backs the row off instead of making it immediately due again", async () => {
            await freshRow("d_backoff");

            const [claimed] = await claimPendingDispatches(10);
            expect(claimed?.id).toBe("d_backoff");

            const before = new Date();
            const outcome = await recordDispatchFailure("d_backoff", "dispatch_failed");
            expect(outcome).toMatchObject({ status: "pending", attemptCount: 1 });

            // The storm was this: a failure reset available_at to now, so the
            // very next drain re-claimed the same row with no pause at all.
            const after = await statusOf("d_backoff");
            expect(after.availableAt.getTime()).toBeGreaterThan(before.getTime() + 1_000);
            expect(await claimPendingDispatches(10)).toEqual([]);
        });

        it("lengthens the delay with each successive failure", async () => {
            await freshRow("d_growing");
            const delays: number[] = [];
            for (let attempt = 0; attempt < 3; attempt++) {
                // Park everything else out of reach each round. A row backed
                // off by an earlier case comes due while this loop runs, and
                // with an earlier available_at it would sort ahead of this one.
                await testDb.db.execute(sql`
                    UPDATE "pdr_ai_v2_founder_weekly_review_dispatches"
                    SET "available_at" = now() + interval '10 years'
                    WHERE "id" <> 'd_growing'
                `);
                await testDb.db.execute(sql`
                    UPDATE "pdr_ai_v2_founder_weekly_review_dispatches"
                    SET "status" = 'pending',
                        "available_at" = now() - interval '1 minute',
                        "updated_at" = now()
                    WHERE "id" = 'd_growing'
                `);
                const claimed = await claimPendingDispatches(10);
                expect(claimed.map(d => d.id)).toEqual(["d_growing"]);
                const at = Date.now();
                await recordDispatchFailure("d_growing", "dispatch_failed");
                delays.push((await statusOf("d_growing")).availableAt.getTime() - at);
            }
            expect(delays[1]).toBeGreaterThan(delays[0]!);
            expect(delays[2]).toBeGreaterThan(delays[1]!);
        });

        it("retires a row once attempts are exhausted and never claims it again", async () => {
            await freshRow("d_exhausted", MAX_DISPATCH_ATTEMPTS);

            const outcome = await recordDispatchFailure("d_exhausted", "dispatch_failed");
            expect(outcome?.status).toBe("failed");
            expect((await statusOf("d_exhausted")).status).toBe("failed");

            // Terminal means terminal: even with available_at in the past, a
            // claim must not pick it back up. `failed` used to be reclaimable,
            // which is what let an exhausted row cycle forever.
            await testDb.db.execute(sql`
                UPDATE "pdr_ai_v2_founder_weekly_review_dispatches"
                SET "available_at" = now() - interval '1 hour'
                WHERE "id" = 'd_exhausted'
            `);
            const claimed = await claimPendingDispatches(10);
            expect(claimed.map(d => d.id)).not.toContain("d_exhausted");
        });
    });
});
