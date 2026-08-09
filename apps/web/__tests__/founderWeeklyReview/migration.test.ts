import { sql } from "drizzle-orm";

import { createFounderWeeklyReviewTestDatabase } from "./testDb";

const describeIfDatabase =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL
        ? describe
        : describe.skip;

describeIfDatabase("Founder Weekly Review migrations", () => {
    it("replays all migrations into a clean schema and creates the new tables and constraints", async () => {
        const testDb = await createFounderWeeklyReviewTestDatabase();
        try {
            const runsTable = await testDb.db.execute(sql`
                SELECT to_regclass('pdr_ai_v2_founder_weekly_review_runs') AS name
            `);
            const opsTable = await testDb.db.execute(sql`
                SELECT to_regclass('pdr_ai_v2_founder_weekly_review_operations') AS name
            `);
            const indexes = await testDb.db.execute(sql`
                SELECT indexname
                FROM pg_indexes
                WHERE tablename IN (
                    'pdr_ai_v2_founder_weekly_review_runs',
                    'pdr_ai_v2_founder_weekly_review_operations'
                )
                ORDER BY indexname
            `);

            expect(runsTable[0]?.name).toBe("pdr_ai_v2_founder_weekly_review_runs");
            expect(opsTable[0]?.name).toBe("pdr_ai_v2_founder_weekly_review_operations");
            expect(indexes.map((row) => row.indexname)).toEqual(
                expect.arrayContaining([
                    "founder_weekly_review_runs_company_request_key_unique",
                    "founder_weekly_review_operations_run_type_request_key_unique",
                    "founder_weekly_review_runs_company_status_created_at_idx",
                ])
            );

            await testDb.db.execute(sql`
                INSERT INTO "pdr_ai_v2_company"
                    ("name", "numberOfEmployees")
                VALUES
                    ('Migration Test Co', '3')
            `);
            await testDb.db.execute(sql`
                INSERT INTO "pdr_ai_v2_founder_weekly_review_runs"
                    (
                        "id",
                        "company_id",
                        "request_key",
                        "reporting_period_start",
                        "reporting_period_end",
                        "status",
                        "review_schema_version",
                        "evidence_snapshot",
                        "evidence_schema_version",
                        "collection_input",
                        "created_by_actor_id"
                    )
                VALUES
                    (
                        'fwr_migration_test',
                        1,
                        'request-key',
                        DATE '2026-07-07',
                        DATE '2026-07-13',
                        'queued',
                        'founder-weekly-review/v1',
                        '{"schemaVersion":"founder-weekly-review-evidence/v1","capturedAt":"2026-07-18T00:00:00.000Z","reportingPeriod":{"start":"2026-07-07","end":"2026-07-13"},"workspaceTimezone":"UTC","items":[],"sourceWarnings":[]}'::jsonb,
                        'founder-weekly-review-evidence/v1',
                        '{"workspaceTimezone":"UTC","actorExternalUserId":"test"}'::jsonb,
                        'user:test'
                    )
            `);

            const inserted = await testDb.db.execute(sql`
                SELECT "status"
                FROM "pdr_ai_v2_founder_weekly_review_runs"
                WHERE "id" = 'fwr_migration_test'
            `);
            expect(inserted[0]?.status).toBe("queued");
        } finally {
            await testDb.close();
        }
    });
});
