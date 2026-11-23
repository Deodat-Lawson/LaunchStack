import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { createWeeklyReviewRepository } from "~/server/vantage/weekly-review-repository";
import {
    topicInputHash,
    topicManifestHash,
    type TopicManifest,
} from "~/server/vantage/weekly-review-topic-types";
import type { WeeklyReviewDatabase, WeeklyReviewQuery } from "~/server/vantage/weekly-review-types";

jest.mock("@launchstack/store/crypto", () => ({
    encryptSecret: jest.fn(),
    decryptSecret: jest.fn(),
}));

// Explicit opt-in for the disposable database fixture.
const fixtureUrl = process.env.VANTAGE_ATTEMPT_PG_URL;
const actor = { companyId: "1", userId: "journal-fixture-owner" };
const concurrency = 8;
const manifest = {
    week: "2026-11-16",
    cutoff: "2026-11-22T00:00:00.000Z",
    asOf: "2026-11-22T00:00:00.000Z",
    epoch: "1",
    expectedActiveId: null,
    configuration: { provider: "configured", scoped: false },
    revisions: { policy: 1, preference: 1, role: null },
    topics: [],
    fixed: [],
    fixedDependencies: [],
    offered: [],
    lane: [],
    carryover: "unavailable",
} satisfies TopicManifest;

(fixtureUrl ? describe : describe.skip)("PostgreSQL provider attempt concurrency", () => {
    let sql: ReturnType<typeof postgres>;
    let schema: string;
    let repository: ReturnType<typeof createWeeklyReviewRepository>;
    let serializationFailures = 0;

    beforeAll(async () => {
        const url = new URL(fixtureUrl!);
        if (
            url.protocol !== "postgres:" ||
            url.hostname !== "127.0.0.1" ||
            url.port !== "55439" ||
            url.pathname !== "/vantage_followup_concurrency" ||
            url.search !== ""
        )
            throw new Error("attempt_database_must_be_dedicated_local_fixture");
        schema = `journal_fixture_${randomUUID().replaceAll("-", "")}`;
        sql = postgres(fixtureUrl!, { max: concurrency + 2, onnotice: () => {} });
        await sql.unsafe(`CREATE SCHEMA ${schema}`);
        // Only these synthetic tables are used. Never migrate or truncate the application schema.
        await sql.unsafe(`CREATE TABLE ${schema}.pdr_ai_v2_vantage_weekly_review_runs (
            id uuid PRIMARY KEY, company_id bigint NOT NULL, owner_id text NOT NULL,
            status text NOT NULL DEFAULT 'reserved', week_start date NOT NULL,
            review_version integer NOT NULL DEFAULT 1, created_at timestamptz DEFAULT now(),
            retrieval_mode text DEFAULT 'topic_first', authority_epoch text DEFAULT '1',
            input_hash text NOT NULL, dependencies jsonb DEFAULT '[]',
            generation_dispatched boolean DEFAULT false, judge_dispatched boolean DEFAULT false,
            exploration_dispatched boolean DEFAULT false, exploration_deadline_at timestamptz,
            snapshot_hash text, last_dispatch_at timestamptz, failure_code text,
            failure_record jsonb, ciphertext text, key_version integer
        )`);
        await sql.unsafe(`CREATE TABLE ${schema}.pdr_ai_v2_vantage_weekly_review_run_manifests (
            run_id uuid PRIMARY KEY, manifest jsonb NOT NULL, manifest_hash text NOT NULL, trace jsonb
        )`);
        await sql.unsafe(`CREATE TABLE ${schema}.pdr_ai_v2_vantage_weekly_review_provider_attempts (
            id uuid PRIMARY KEY, run_id uuid NOT NULL, company_id bigint NOT NULL,
            owner_id text NOT NULL, stage text NOT NULL, attempt_ordinal integer NOT NULL,
            message_bytes integer, started_at timestamptz DEFAULT clock_timestamp(),
            settled_at timestamptz, outcome jsonb
        )`);
        const database: WeeklyReviewDatabase = {
            async transaction<T>(work: (query: WeeklyReviewQuery) => Promise<T>): Promise<T> {
                try {
                    return (await sql.begin(async tx => {
                        // SET does not acquire a transaction snapshot before SERIALIZABLE is set.
                        await tx.unsafe(`SET LOCAL search_path TO ${schema}`);
                        const query: WeeklyReviewQuery = async (text, parameters = []) => {
                            // Match the application's string bindings: postgres otherwise
                            // JSON-encodes an already serialized $n::jsonb string a second time.
                            const bindings = parameters.map(value =>
                                typeof value === "string" ? tx.typed(value, 25) : value
                            );
                            const rows = await tx.unsafe(text, bindings as never[]);
                            if (
                                text.startsWith(
                                    "SELECT * FROM pdr_ai_v2_vantage_weekly_review_runs"
                                ) &&
                                text.endsWith(" FOR UPDATE")
                            )
                                // Widen the real row-lock overlap so all callers take competing
                                // snapshots; this does not serialize the test adapter or mock SQL.
                                await tx.unsafe("SELECT pg_sleep(0.02)");
                            return [...rows];
                        };
                        return work(query);
                    })) as T;
                } catch (error) {
                    if ((error as { code?: string }).code === "40001") serializationFailures++;
                    throw error;
                }
            },
        };
        repository = createWeeklyReviewRepository(database, async () => {});
    });

    afterAll(async () => {
        if (!sql) return;
        try {
            // schema is generated above, never derived from a database URL or caller input.
            if (schema && /^journal_fixture_[a-f0-9]{32}$/.test(schema))
                await sql.unsafe(`DROP SCHEMA ${schema} CASCADE`);
        } finally {
            await sql.end();
        }
    });

    async function reserve() {
        const id = randomUUID();
        await sql.unsafe(
            `INSERT INTO ${schema}.pdr_ai_v2_vantage_weekly_review_runs
             (id,company_id,owner_id,week_start,input_hash) VALUES($1,$2,$3,$4,$5)`,
            [id, actor.companyId, actor.userId, manifest.week, topicInputHash(manifest)]
        );
        await sql.unsafe(
            `INSERT INTO ${schema}.pdr_ai_v2_vantage_weekly_review_run_manifests
             (run_id,manifest,manifest_hash,trace) VALUES($1,$2::jsonb,$3,'{"synthetic":true}')`,
            [id, sql.json(manifest), topicManifestHash(manifest)]
        );
        return id;
    }

    const start = (id: string, deadlineAt?: number) =>
        repository.beginProviderAttempt(actor, id, {
            stage: "digest",
            attempt: 1,
            messageBytes: 30,
            deadlineAt,
        });

    it("journals eight simultaneous physical starts without exhausting serialization retries", async () => {
        const id = await reserve();
        const results = await Promise.allSettled(
            Array.from({ length: concurrency }, () => start(id))
        );
        const errors = results.flatMap(result =>
            result.status === "rejected" ? [String(result.reason)] : []
        );
        expect(errors).toEqual([]);
        const rows = await sql.unsafe(
            `SELECT id FROM ${schema}.pdr_ai_v2_vantage_weekly_review_provider_attempts WHERE run_id=$1`,
            [id]
        );
        expect(rows).toHaveLength(concurrency);
        expect(new Set(rows.map(row => row.id)).size).toBe(concurrency);
    });

    it("settles eight physical attempts concurrently with failure and preserves terminal accounting", async () => {
        const id = await reserve();
        const attempts: string[] = [];
        for (let i = 0; i < concurrency; i++) attempts.push(await start(id));
        const outcome = (i: number) => ({
            statusClass: i % 2 ? "unavailable" : "success",
            httpStatus: i % 2 ? 503 : 200,
        });
        const results = await Promise.allSettled([
            repository.fail(actor, id, "topic_digest_failed:provider", { stage: "digest" }),
            ...attempts.map((attempt, i) =>
                repository.completeProviderAttempt(actor, id, attempt, outcome(i))
            ),
        ]);
        const errors = results.flatMap(result =>
            result.status === "rejected" ? [String(result.reason)] : []
        );
        expect(errors).toEqual([]);
        const [run] = await sql.unsafe(
            `SELECT status,failure_record FROM ${schema}.pdr_ai_v2_vantage_weekly_review_runs WHERE id=$1`,
            [id]
        );
        const rows = await sql.unsafe(
            `SELECT settled_at FROM ${schema}.pdr_ai_v2_vantage_weekly_review_provider_attempts WHERE run_id=$1`,
            [id]
        );
        expect(run?.status).toBe("failed");
        expect(rows).toHaveLength(concurrency);
        expect(rows.every(row => row.settled_at != null)).toBe(true);
        expect(run?.failure_record).toMatchObject({
            counts: { providerAttempts: concurrency, providerFailures: concurrency / 2 },
        });
        const [saved] = await sql.unsafe(
            `SELECT trace FROM ${schema}.pdr_ai_v2_vantage_weekly_review_run_manifests WHERE run_id=$1`,
            [id]
        );
        expect(saved?.trace).toBeNull();
        await repository.completeProviderAttempt(actor, id, attempts[0]!, outcome(0));
        await expect(start(id)).rejects.toThrow("review_not_reserved");
    });

    it("checks deadlines after queue wait and releases the queue after rejection", async () => {
        const id = await reserve();
        const first = start(id);
        const expired = start(id, Date.now() + 5);
        const third = start(id);
        const results = await Promise.allSettled([first, expired, third]);
        expect(results.map(result => result.status)).toEqual([
            "fulfilled",
            "rejected",
            "fulfilled",
        ]);
        expect(String((results[1] as PromiseRejectedResult).reason)).toContain(
            "provider_attempt_timeout"
        );
        const rows = await sql.unsafe(
            `SELECT id FROM ${schema}.pdr_ai_v2_vantage_weekly_review_provider_attempts WHERE run_id=$1`,
            [id]
        );
        expect(rows).toHaveLength(2);
    });

    afterAll(() => {
        console.info(
            `PostgreSQL journal fixture observed ${serializationFailures} serialization failures`
        );
    });
});
