import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { assertVantageV2Authority } from "~/server/vantage/v2/authority";
import { createTaskExecutionRepository } from "~/server/vantage/v2/execution-repository";
import {
    WeeklyReviewConflict,
    type WeeklyReviewDatabase,
    type WeeklyReviewQuery,
} from "~/server/vantage/weekly-review-types";

jest.mock("~/server/vantage/weekly-review-service", () => ({ weeklyReviewDatabase: {} }));
jest.mock("~/server/vantage/v2/authority", () => ({ assertVantageV2Authority: jest.fn() }));
jest.mock("~/server/vantage/v2/enabled", () => ({ vantageV2Enabled: () => true }));

const fixtureUrl = process.env.VANTAGE_ATTEMPT_PG_URL;
(fixtureUrl ? describe : describe.skip)("PostgreSQL refused claim", () => {
    let sql: ReturnType<typeof postgres>;

    beforeAll(async () => {
        const url = new URL(fixtureUrl!);
        if (
            url.protocol !== "postgres:" ||
            url.hostname !== "127.0.0.1" ||
            url.port !== "55439" ||
            url.pathname !== "/vantage_followup_concurrency" ||
            url.search !== ""
        )
            throw new Error("claim_database_must_be_dedicated_local_fixture");
        // Every transaction uses this session's temporary tables, including the intervening edit.
        sql = postgres(fixtureUrl!, { max: 1 });
        await sql`SET search_path TO pg_temp`;
        await sql`CREATE TEMP TABLE pdr_ai_v2_vantage_v2_plans (
            id uuid PRIMARY KEY, review_id uuid, company_id bigint, owner_id text,
            version int, hash text, approved_version int, approved_hash text)`;
        await sql`CREATE TEMP TABLE pdr_ai_v2_vantage_v2_tasks (
            id uuid PRIMARY KEY, plan_id uuid, status text, assignee_type text, version int,
            reason text, attempt int DEFAULT 0, attempt_id uuid, claim_token uuid, lease_until timestamptz)`;
    });

    afterAll(async () => {
        if (sql) await sql.end();
    });

    test.each([
        {
            change: "edit and reapprove",
            taskVersion: 5,
            planVersion: 2,
            approved: true,
            status: "queued",
        },
        {
            change: "replace approval without changing this task",
            taskVersion: 3,
            planVersion: 2,
            approved: true,
            status: "queued",
        },
        {
            change: "requeue only",
            taskVersion: 4,
            planVersion: 1,
            approved: true,
            status: "queued",
        },
        {
            change: "withdraw approval only",
            taskVersion: 3,
            planVersion: 1,
            approved: false,
            status: "queued",
        },
        { change: "unchanged", taskVersion: 3, planVersion: 1, approved: true, status: "blocked" },
    ])(
        "refusal after $change leaves the task $status",
        async ({ taskVersion, planVersion, approved, status }) => {
            const planId = randomUUID();
            const taskId = randomUUID();
            await sql`INSERT INTO pdr_ai_v2_vantage_v2_plans VALUES
            (${planId}, ${randomUUID()}, 1, 'owner', 1, 'hash-1', 1, 'hash-1')`;
            await sql`INSERT INTO pdr_ai_v2_vantage_v2_tasks (id,plan_id,status,assignee_type,version)
            VALUES (${taskId}, ${planId}, 'queued', 'persona', 3)`;

            const denial = new WeeklyReviewConflict("review_access_denied", 403);
            jest.mocked(assertVantageV2Authority).mockRejectedValueOnce(denial);
            const db: WeeklyReviewDatabase = {
                async transaction<T>(work: (query: WeeklyReviewQuery) => Promise<T>): Promise<T> {
                    try {
                        return (await sql.begin(tx =>
                            work(async (text, args = []) => [
                                ...(await tx.unsafe(text, args as never[])),
                            ])
                        )) as T;
                    } catch (error) {
                        if (error !== denial) throw error;
                        // The first attempt has rolled back. Commit the owner's state before the refusal writes.
                        const hash = "hash-" + planVersion;
                        await sql.begin(async tx => {
                            await tx`UPDATE pdr_ai_v2_vantage_v2_plans SET version=${planVersion},
                            hash=${hash}, approved_version=${approved ? planVersion : null},
                            approved_hash=${approved ? hash : null} WHERE id=${planId}`;
                            await tx`UPDATE pdr_ai_v2_vantage_v2_tasks SET version=${taskVersion} WHERE id=${taskId}`;
                        });
                        throw error;
                    }
                },
            };
            await expect(createTaskExecutionRepository(db).claim(taskId)).resolves.toBeNull();
            const [task] =
                await sql`SELECT status,attempt,version FROM pdr_ai_v2_vantage_v2_tasks WHERE id=${taskId}`;
            const attempted = status === "blocked" ? 1 : 0;
            expect(task).toEqual({ status, attempt: attempted, version: taskVersion + attempted });
        }
    );
});
