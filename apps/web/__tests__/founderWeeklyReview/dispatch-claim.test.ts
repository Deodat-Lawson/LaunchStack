/**
 * The outbox claim runs as raw SQL, so it has to be exercised against a real
 * database — a mocked query builder would prove nothing about SKIP LOCKED,
 * the CTE, or the snake_case row mapping.
 */

import { sql } from "drizzle-orm";

import { createFounderWeeklyReviewTestDatabase } from "./testDb";

const describeIfDatabase =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL
        ? describe
        : describe.skip;

type TestDatabase = Awaited<ReturnType<typeof createFounderWeeklyReviewTestDatabase>>;

describeIfDatabase("founder weekly review dispatch claiming", () => {
    let testDb: TestDatabase;
    let claimPendingDispatches: typeof import("~/server/founder-weekly-review/dispatch-service").claimPendingDispatches;

    beforeAll(async () => {
        testDb = await createFounderWeeklyReviewTestDatabase();
        // The service binds `db` at import time, so the test database has to be
        // installed before the module is first required.
        jest.doMock("~/server/db", () => ({ db: testDb.db }));
        ({ claimPendingDispatches } = await import(
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

        expect(claimed.map((d) => d.id)).toEqual(["d_first", "d_second"]);
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
        expect(claimed.map((d) => d.id)).toEqual(["d_first"]);
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
});
