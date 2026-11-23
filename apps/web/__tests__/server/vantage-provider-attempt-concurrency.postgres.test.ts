import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { fingerprint } from "@launchstack/pipelines/vantage/weekly-review-validation";
import { calculateWeeklyReviewBudget } from "@launchstack/pipelines/vantage/weekly-review-v21";
import { createWeeklyReviewRepository } from "~/server/vantage/weekly-review-repository";
import type { TopicFreeze } from "~/server/vantage/weekly-review-topic-freeze";
import {
    topicInputHash,
    topicManifestHash,
    type TopicManifest,
} from "~/server/vantage/weekly-review-topic-types";
import type { WeeklyReviewDatabase, WeeklyReviewQuery } from "~/server/vantage/weekly-review-types";

jest.mock("@launchstack/store/crypto", () => ({
    encryptSecret: jest.fn((value: string) => ({ ciphertext: value, keyVersion: 1 })),
    decryptSecret: jest.fn((value: string) => value),
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
    let otherRequest: ReturnType<typeof createWeeklyReviewRepository>;
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
            schema_version text DEFAULT 'vantage-weekly-review/v2.1', accepted_at timestamptz,
            idempotency_key text NOT NULL, pinned_cutoff timestamptz, pinned_as_of timestamptz,
            input_hash text NOT NULL, dependencies jsonb DEFAULT '[]',
            generation_dispatched boolean DEFAULT false, judge_dispatched boolean DEFAULT false,
            exploration_dispatched boolean DEFAULT false, exploration_deadline_at timestamptz,
            snapshot_hash text, last_dispatch_at timestamptz, failure_code text,
            failure_record jsonb, ciphertext text, key_version integer,
            UNIQUE(company_id,owner_id,idempotency_key)
        )`);
        await sql.unsafe(`CREATE TABLE ${schema}.pdr_ai_v2_vantage_weekly_review_run_manifests (
            run_id uuid PRIMARY KEY, company_id bigint NOT NULL, owner_id text NOT NULL,
            manifest jsonb NOT NULL, manifest_hash text NOT NULL, trace jsonb,
            digest_ids jsonb, snapshot_commitment jsonb
        )`);
        await sql.unsafe(`CREATE TABLE ${schema}.pdr_ai_v2_vantage_weekly_review_active (
            company_id bigint NOT NULL, owner_id text NOT NULL, week_start date NOT NULL,
            run_id uuid NOT NULL, PRIMARY KEY(company_id,owner_id,week_start)
        )`);
        await sql.unsafe(`CREATE TABLE ${schema}.pdr_ai_v2_vantage_weekly_review_activation_events (
            id uuid PRIMARY KEY, company_id bigint NOT NULL, owner_id text NOT NULL,
            week_start date NOT NULL, actor_id text NOT NULL, idempotency_key text NOT NULL,
            payload_hash text NOT NULL, kind text NOT NULL, previous_run_id uuid, run_id uuid NOT NULL,
            UNIQUE(company_id,owner_id,idempotency_key)
        )`);
        await sql.unsafe(`CREATE TABLE ${schema}.pdr_ai_v2_vantage_weekly_review_decisions (
            id uuid PRIMARY KEY, company_id bigint NOT NULL, run_id uuid NOT NULL,
            actor_id text NOT NULL, idempotency_key text NOT NULL, payload_hash text NOT NULL,
            ciphertext text NOT NULL, version integer NOT NULL,
            UNIQUE(company_id,run_id,actor_id,idempotency_key)
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
                                (text.startsWith(
                                    "SELECT * FROM pdr_ai_v2_vantage_weekly_review_runs"
                                ) &&
                                    text.endsWith(" FOR UPDATE")) ||
                                /^\s*INSERT INTO pdr_ai_v2_vantage_weekly_review_runs/.test(text) ||
                                text.startsWith("SELECT id,payload_hash,run_id")
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
        otherRequest = createWeeklyReviewRepository(database, async () => {});
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

    async function reserve(runManifest: TopicManifest = manifest) {
        const id = randomUUID();
        await sql.unsafe(
            `INSERT INTO ${schema}.pdr_ai_v2_vantage_weekly_review_runs
             (id,company_id,owner_id,week_start,input_hash,idempotency_key)
             VALUES($1,$2,$3,$4,$5,$6)`,
            [id, actor.companyId, actor.userId, runManifest.week, topicInputHash(runManifest), id]
        );
        await sql.unsafe(
            `INSERT INTO ${schema}.pdr_ai_v2_vantage_weekly_review_run_manifests
             (run_id,company_id,owner_id,manifest,manifest_hash,trace)
             VALUES($1,$2,$3,$4::jsonb,$5,'{"synthetic":true}')`,
            [
                id,
                actor.companyId,
                actor.userId,
                sql.typed(JSON.stringify(runManifest), 25),
                topicManifestHash(runManifest),
            ]
        );
        return id;
    }

    const start = (id: string, deadlineAt?: number, request = repository) =>
        request.beginProviderAttempt(actor, id, {
            stage: "digest",
            attempt: 1,
            messageBytes: 30,
            deadlineAt,
        });

    it("pins one reservation and one manifest for concurrent same-key submissions across requests", async () => {
        const before = serializationFailures;
        const key = randomUUID();
        const results = await Promise.all(
            Array.from({ length: concurrency }, (_, i) => {
                const request = i % 2 ? repository : otherRequest;
                return request.reserveTopic(actor, key, randomUUID(), manifest);
            })
        );
        expect(results.filter(run => run.created)).toHaveLength(1);
        expect(new Set(results.map(run => run.id)).size).toBe(1);
        expect(serializationFailures - before).toBe(0);
        const [saved] = await sql.unsafe(
            `SELECT manifest_hash FROM ${schema}.pdr_ai_v2_vantage_weekly_review_run_manifests
             WHERE run_id=$1`,
            [results[0]!.id]
        );
        expect(saved?.manifest_hash).toBe(topicManifestHash(manifest));
    });

    it("journals eight simultaneous physical starts without exhausting serialization retries", async () => {
        const id = await reserve();
        const results = await Promise.allSettled(
            Array.from({ length: concurrency }, (_, i) =>
                start(id, undefined, i % 2 ? repository : otherRequest)
            )
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
        const before = serializationFailures;
        const attempts: string[] = [];
        for (let i = 0; i < concurrency; i++) attempts.push(await start(id));
        const outcome = (i: number) => ({
            statusClass: i % 2 ? "unavailable" : "success",
            httpStatus: i % 2 ? 503 : 200,
        });
        const results = await Promise.allSettled([
            otherRequest.recordDigestPreparation(actor, id, {
                timing: {
                    digestCompletedAt: new Date().toISOString(),
                    digestDurationMs: 20,
                    digestOutcome: "failed",
                },
            }),
            repository.fail(actor, id, "topic_digest_failed:provider", { stage: "digest" }),
            ...attempts.map((attempt, i) =>
                (i % 2 ? repository : otherRequest).completeProviderAttempt(
                    actor,
                    id,
                    attempt,
                    outcome(i)
                )
            ),
        ]);
        const errors = results.flatMap(result =>
            result.status === "rejected" ? [String(result.reason)] : []
        );
        expect(errors).toEqual([]);
        expect(serializationFailures - before).toBe(0);
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

    it("orders stage advances, attempt settlement, acceptance, and later recovery writers", async () => {
        const before = serializationFailures;
        const sourceText = "Approved synthetic weekly context.";
        const sourceHash = createHash("sha256").update(sourceText).digest("hex");
        const source = {
            ref: "doc:1@1",
            id: "1",
            version: "1",
            hash: sourceHash,
            purpose: "company-architecture",
            audience: "company",
        } as const;
        const dependency = {
            kind: "document",
            id: source.id,
            version: source.version,
            hash: source.hash,
            purpose: source.purpose,
        } as const;
        const runManifest: TopicManifest = {
            ...manifest,
            week: "2026-11-23",
            cutoff: "2026-11-29T00:00:00.000Z",
            asOf: "2026-11-29T00:00:00.000Z",
            fixed: [source],
            fixedDependencies: [dependency],
        };
        const id = randomUUID();
        await repository.reserveTopic(actor, randomUUID(), id, runManifest);
        const [, digest] = await Promise.all([
            repository.beginDigestPreparation(actor, id),
            start(id, undefined, otherRequest),
            repository.recordDigestPreparation(actor, id, {
                timing: {
                    digestCompletedAt: new Date().toISOString(),
                    digestDurationMs: 20,
                    digestOutcome: "ready",
                },
            }),
            otherRequest.claimExploration(actor, id),
        ]);
        const context = {
            schemaVersion: "vantage-topic-retrieval/v1",
            mode: "topic-first",
            guidanceLabel: "owner notes, not evidence",
            topics: [],
            seedReasons: [],
            lane: { outcome: "none_eligible", candidates: 0, admitted: 0 },
        } as const;
        const snapshot = {
            candidateId: id,
            week: runManifest.week,
            asOf: runManifest.asOf,
            role: "owner",
            mandatoryCoverage: { required: 1, included: 1 },
            sources: [{ ...source, title: "Synthetic weekly context", text: sourceText }],
        };
        const frozen: TopicFreeze = {
            input: {
                ...snapshot,
                retrievalContext: {
                    ...context,
                    topics: [],
                    seedReasons: [],
                    traceHash: fingerprint([
                        topicManifestHash(runManifest),
                        { ...snapshot, retrievalContext: context },
                    ]),
                },
            },
            dependencies: [dependency],
            summary: { mode: context.mode, lane: context.lane, seedReasons: [], outcome: "frozen" },
        };
        const snapshotHash = fingerprint(frozen.input);
        const success = { statusClass: "success", httpStatus: 200 };
        const [, exploration] = await Promise.all([
            repository.completeProviderAttempt(actor, id, digest, success),
            otherRequest.beginProviderAttempt(actor, id, {
                stage: "exploration",
                attempt: 1,
                messageBytes: 30,
            }),
            repository.recordExploration(actor, id, {
                timing: { explorationCompletedAt: new Date().toISOString() },
            }),
            otherRequest.freezeTopic(actor, id, async () => frozen),
            repository.authorizeDispatch(actor, id, "generation", null, snapshotHash),
        ]);
        const [, generation] = await Promise.all([
            repository.completeProviderAttempt(actor, id, exploration, success),
            otherRequest.beginProviderAttempt(actor, id, {
                stage: "generation",
                attempt: 1,
                messageBytes: 30,
                snapshotHash,
                expectedActiveId: null,
            }),
            repository.revalidateDispatch(actor, id, "generation", null, snapshotHash),
            otherRequest.authorizeDispatch(actor, id, "judge", null, snapshotHash),
        ]);
        const [, judge] = await Promise.all([
            repository.completeProviderAttempt(actor, id, generation, success),
            otherRequest.beginProviderAttempt(actor, id, {
                stage: "judge",
                attempt: 1,
                messageBytes: 30,
                snapshotHash,
            }),
        ]);
        const report = { topics: [{ id: "synthetic-topic" }] };
        const hash = (value: unknown) =>
            createHash("sha256").update(JSON.stringify(value)).digest("hex");
        const evidence = {
            schemaVersion: "vantage-admission/v2",
            candidateId: id,
            reportHash: hash(report),
            inputHash: hash(frozen.input),
            evaluationHash: fingerprint({ synthetic: true }),
            inputSnapshot: frozen.input,
            budget: calculateWeeklyReviewBudget(frozen.input, "topic-first"),
            evaluation: { status: "assessed", verdict: "pass", integrityIssues: [] },
        };
        const [, accepted, expired, restored, version] = await Promise.all([
            otherRequest.completeProviderAttempt(actor, id, judge, success),
            repository.accept(actor, id, { report, evidence, expectedActiveId: null }),
            otherRequest.expireUncertain(actor, id.toUpperCase()),
            repository.restore(actor, id, { expectedActiveId: id, key: randomUUID() }),
            otherRequest.decide(actor, id, {
                key: randomUUID(),
                expectedVersion: 1,
                topicId: "synthetic-topic",
                decision: "Record decision",
            }),
            repository.fail(actor, id, "candidate_not_admitted"),
        ]);
        expect(accepted).toBe(id);
        expect(expired).toEqual({ id: id.toUpperCase(), status: "accepted", expired: false });
        expect(restored).toMatchObject({ runId: id, replayed: false });
        expect(version).toBe(2);
        expect(await repository.active(actor, runManifest.week)).toBe(id);
        const status = await repository.status(actor, id);
        expect(status).toMatchObject({
            status: "accepted",
            review_version: 2,
            failureRecord: null,
        });
        expect(status.providerAttempts.map(attempt => attempt.stage).sort()).toEqual([
            "digest",
            "exploration",
            "generation",
            "judge",
        ]);
        expect(status.providerAttempts.every(attempt => attempt.status === "settled")).toBe(true);
        expect(serializationFailures - before).toBe(0);
    });

    it("clears only the expired run and preserves late settlement plus read-only historical status", async () => {
        const id = await reserve();
        const historical = await reserve();
        const attempt = await start(id);
        await sql.unsafe(
            `UPDATE ${schema}.pdr_ai_v2_vantage_weekly_review_runs
             SET last_dispatch_at=now()-interval '1 hour',ciphertext='synthetic',key_version=1
             WHERE id=$1 OR id=$2`,
            [id, historical]
        );
        await sql.unsafe(
            `UPDATE ${schema}.pdr_ai_v2_vantage_weekly_review_runs SET status='failed' WHERE id=$1`,
            [historical]
        );
        const [expired] = await Promise.all([
            repository.expireUncertain(actor, id),
            otherRequest.completeProviderAttempt(actor, id, attempt, {
                statusClass: "rate_limited",
                httpStatus: 429,
            }),
        ]);
        expect(expired).toEqual({ id, status: "failed", expired: true });
        expect(await repository.status(actor, id)).toMatchObject({
            failureRecord: {
                counts: { providerAttempts: 1, providerFailures: 1 },
                provider: { statusClass: "rate_limited", httpStatus: 429 },
            },
        });
        expect(await repository.status(actor, historical)).toMatchObject({
            status: "failed",
            failureRecord: { code: "candidate_not_admitted" },
            providerAttempts: [],
        });
        expect(await repository.list(actor)).toContainEqual(
            expect.objectContaining({ id: historical, status: "failed" })
        );
        const rows = await sql.unsafe(
            `SELECT r.id,r.ciphertext,r.key_version,m.trace
             FROM ${schema}.pdr_ai_v2_vantage_weekly_review_runs r
             JOIN ${schema}.pdr_ai_v2_vantage_weekly_review_run_manifests m ON m.run_id=r.id
             WHERE r.id=$1 OR r.id=$2`,
            [id, historical]
        );
        expect(rows).toEqual(
            expect.arrayContaining([
                { id, ciphertext: null, key_version: null, trace: null },
                {
                    id: historical,
                    ciphertext: "synthetic",
                    key_version: 1,
                    trace: { synthetic: true },
                },
            ])
        );
    });

    async function reserveRestoreCandidates(firstWeek: string, secondWeek: string) {
        const candidates = await Promise.all([
            reserve({ ...manifest, week: firstWeek }),
            reserve({ ...manifest, week: secondWeek }),
        ]);
        await sql.unsafe(
            `UPDATE ${schema}.pdr_ai_v2_vantage_weekly_review_runs
             SET status='accepted',ciphertext='synthetic',key_version=1 WHERE id=$1 OR id=$2`,
            candidates
        );
        return candidates;
    }

    it("keeps the owner-week active pointer compare-and-swap across different runs", async () => {
        const week = "2026-11-30";
        const [first, second] = await reserveRestoreCandidates(week, week);
        const results = await Promise.allSettled([
            repository.restore(actor, first, { expectedActiveId: null, key: randomUUID() }),
            otherRequest.restore(actor, second, { expectedActiveId: null, key: randomUUID() }),
        ]);
        const winners = results.flatMap(result =>
            result.status === "fulfilled" ? [result.value] : []
        );
        const losses = results.flatMap(result =>
            result.status === "rejected" ? [String(result.reason)] : []
        );
        expect(winners).toHaveLength(1);
        expect(losses).toEqual(["Error: active_review_changed"]);
        expect(await repository.active(actor, week)).toBe(winners[0]!.runId);
        const events = await sql.unsafe(
            `SELECT run_id FROM ${schema}.pdr_ai_v2_vantage_weekly_review_activation_events
             WHERE company_id=$1 AND owner_id=$2 AND week_start=$3`,
            [actor.companyId, actor.userId, week]
        );
        expect(events).toEqual([{ run_id: winners[0]!.runId }]);
    });

    it("returns an idempotency conflict when two weeks reuse one restore key", async () => {
        const firstWeek = "2026-12-07";
        const secondWeek = "2026-12-14";
        const [first, second] = await reserveRestoreCandidates(firstWeek, secondWeek);
        const key = randomUUID();
        const results = await Promise.allSettled([
            repository.restore(actor, first, { expectedActiveId: null, key }),
            otherRequest.restore(actor, second, { expectedActiveId: null, key }),
        ]);
        const winners = results.flatMap(result =>
            result.status === "fulfilled" ? [result.value] : []
        );
        const losses = results.flatMap(result =>
            result.status === "rejected" ? [String(result.reason)] : []
        );
        expect(winners).toHaveLength(1);
        expect(losses).toEqual(["Error: idempotency_conflict"]);
        const [activeFirst, activeSecond] = await Promise.all([
            repository.active(actor, firstWeek),
            otherRequest.active(actor, secondWeek),
        ]);
        expect([activeFirst, activeSecond]).toEqual(
            winners[0]!.runId === first ? [first, null] : [null, second]
        );
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
