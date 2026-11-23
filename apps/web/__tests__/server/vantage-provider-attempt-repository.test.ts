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

const id = "00000000-0000-4000-8000-000000000001";
const actor = { companyId: "1", userId: "owner" };
function fixture() {
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
    } as TopicManifest;
    const state = {
        row: {
            id,
            company_id: actor.companyId,
            owner_id: actor.userId,
            status: "reserved",
            week_start: manifest.week,
            review_version: 1,
            created_at: new Date().toISOString(),
            retrieval_mode: "topic_first",
            authority_epoch: "1",
            input_hash: topicInputHash(manifest),
            dependencies: [],
            generation_dispatched: true,
            judge_dispatched: false,
            exploration_dispatched: true,
            exploration_deadline_at: new Date(Date.now() + 60000).toISOString(),
            snapshot_hash: "snapshot",
            failure_code: null,
            failure_record: null,
            ciphertext: null,
            key_version: null,
        } as Record<string, unknown>,
        attempts: [] as Record<string, unknown>[],
        active: null as string | null,
        trace: { synthetic: true } as object | null,
        usage: [] as Parameters<NonNullable<WeeklyReviewQuery["recordAiUsage"]>>[],
    };
    const meter = jest.fn(async () => {});
    const sqlLog: { sql: string; args: unknown[] }[] = [];
    let tail = Promise.resolve();
    const database: WeeklyReviewDatabase = {
        async transaction<T>(work: (query: WeeklyReviewQuery) => Promise<T>): Promise<T> {
            const wait = tail;
            let release!: () => void;
            tail = new Promise<void>(resolve => {
                release = resolve;
            });
            await wait;
            const local = structuredClone(state);
            const query: WeeklyReviewQuery = async (sql, args = []) => {
                sqlLog.push({ sql, args });
                if (sql.startsWith("SET ")) return [];
                if (sql.startsWith("SELECT * FROM pdr_ai_v2_vantage_weekly_review_runs"))
                    return args[0] === id && args[1] === actor.companyId && args[2] === actor.userId
                        ? [local.row]
                        : [];
                if (sql.startsWith("SELECT * FROM pdr_ai_v2_vantage_weekly_review_run_manifests"))
                    return [{ manifest, manifest_hash: topicManifestHash(manifest) }];
                if (sql.startsWith("SELECT run_id"))
                    return local.active ? [{ run_id: local.active }] : [];
                if (
                    sql.startsWith("INSERT INTO pdr_ai_v2_vantage_weekly_review_provider_attempts")
                ) {
                    local.attempts.push({
                        id: args[0],
                        run_id: args[1],
                        company_id: args[2],
                        owner_id: args[3],
                        stage: args[4],
                        attempt_ordinal: args[5],
                        message_bytes: args[6],
                        started_at: new Date().toISOString(),
                        settled_at: null,
                        outcome: null,
                    });
                    return [];
                }
                if (sql.startsWith("SELECT outcome,settled_at"))
                    return local.attempts.filter(
                        a =>
                            a.id === args[0] &&
                            a.run_id === args[1] &&
                            a.company_id === args[2] &&
                            a.owner_id === args[3]
                    );
                if (sql.startsWith("UPDATE pdr_ai_v2_vantage_weekly_review_provider_attempts")) {
                    const a = local.attempts.find(a => a.id === args[0])!;
                    a.outcome = JSON.parse(String(args[1]));
                    a.settled_at = new Date().toISOString();
                    return [];
                }
                if (sql.startsWith("SELECT count(*)"))
                    return [
                        {
                            attempts: local.attempts.length,
                            failures: local.attempts.filter(
                                a =>
                                    a.outcome &&
                                    (a.outcome as { statusClass: string }).statusClass !== "success"
                            ).length,
                        },
                    ];
                if (sql.startsWith("SELECT outcome,stage,message_bytes FROM"))
                    return [...local.attempts].reverse().slice(0, 1);
                if (sql.startsWith("SELECT id,stage,attempt_ordinal"))
                    return [...local.attempts].reverse();
                if (sql.includes("SET status='failed'")) {
                    local.row.status = "failed";
                    local.row.failure_code = sql.includes("dispatch_uncertain_expired")
                        ? "dispatch_uncertain_expired"
                        : args[3];
                    local.row.failure_record = JSON.parse(
                        String(sql.includes("dispatch_uncertain_expired") ? args[2] : args[4])
                    );
                    local.row.ciphertext = null;
                    local.row.key_version = null;
                    return [{ id }];
                }
                if (sql.includes("SET trace=NULL") && args[0] === id) {
                    local.trace = null;
                    return [];
                }
                if (sql.includes("SET failure_record=$2")) {
                    local.row.failure_record = JSON.parse(String(args[1]));
                    return [];
                }
                if (sql.startsWith("SELECT id,week_start,status")) return [local.row];
                return [];
            };
            query.recordAiUsage = async (...args) => {
                local.usage.push(args);
                await meter();
            };
            try {
                const result = await work(query);
                Object.assign(state, local);
                return result;
            } finally {
                release();
            }
        },
    };
    const authority = jest.fn(async () => {});
    return {
        state,
        sqlLog,
        authority,
        meter,
        repository: createWeeklyReviewRepository(database, authority),
    };
}
const start = (f: ReturnType<typeof fixture>, attempt = 1) =>
    f.repository.beginProviderAttempt(actor, id, {
        stage: "generation",
        attempt,
        messageBytes: 120,
        snapshotHash: "snapshot",
        expectedActiveId: null,
    });

it("journals each physical retry and reported metering without rewriting dispatch reservations", async () => {
    const f = fixture(),
        first = await start(f);
    await f.repository.completeProviderAttempt(actor, id, first, {
        statusClass: "rate_limited",
        httpStatus: 429,
        retryAfterMs: 1000,
    });
    const second = await start(f, 2);
    await f.repository.completeProviderAttempt(actor, id, second, {
        statusClass: "success",
        httpStatus: 200,
        usage: {
            inputTokens: 9,
            outputTokens: 4,
            totalTokens: 13,
            cachedInputTokens: 2,
            reasoningTokens: 1,
        },
    });
    const result = await f.repository.status(actor, id);
    expect(result.providerAttempts).toHaveLength(2);
    expect(result.providerAttempts[0]).toMatchObject({
        attempt: 2,
        messageBytes: 120,
        status: "settled",
        outcome: { usage: { totalTokens: 13, cachedInputTokens: 2, reasoningTokens: 1 } },
    });
    expect(f.authority).toHaveBeenCalledTimes(2);
    expect(f.sqlLog.filter(item => item.sql.includes("SET generation_dispatched"))).toHaveLength(0);
    expect(f.sqlLog.some(item => item.sql.includes("FOR UPDATE"))).toBe(true);
});
it.each(["authority", "snapshot", "active", "accepted", "judge"])(
    "blocks a retry after %s changes before inserting an attempt",
    async change => {
        const f = fixture();
        await start(f);
        if (change === "authority") f.authority.mockRejectedValueOnce(new Error("revoked"));
        if (change === "snapshot") f.state.row.snapshot_hash = "changed";
        if (change === "active") f.state.active = "replacement";
        if (change === "accepted") f.state.row.status = "accepted";
        if (change === "judge") f.state.row.judge_dispatched = true;
        await expect(start(f, 2)).rejects.toThrow();
        expect(f.state.attempts).toHaveLength(1);
    }
);
it("records content-free terminal failure and allows idempotent post-terminal settlement", async () => {
    const f = fixture(),
        attempt = await start(f);
    await f.repository.fail(actor, id, "invalid_source_citation", {
        stage: "generation",
        validatorCodes: ["invalid_source_citation", "CONFIDENTIAL_SOURCE_MARKER"],
        counts: { citationsChecked: 3, citationsFailed: 1, sourceUnits: 2 },
    });
    expect(f.state.trace).toBeNull();
    expect(f.state.row).toMatchObject({
        status: "failed",
        ciphertext: null,
        key_version: null,
        failure_record: {
            stage: "generation",
            counts: { providerAttempts: 1, providerFailures: 0 },
        },
    });
    const outcome = {
        statusClass: "unavailable",
        httpStatus: 503,
        error: "CONFIDENTIAL_SOURCE_MARKER",
    };
    await f.repository.completeProviderAttempt(actor, id, attempt, outcome);
    await f.repository.completeProviderAttempt(actor, id, attempt, outcome);
    expect(f.state.row).toMatchObject({
        status: "failed",
        failure_record: {
            counts: { providerAttempts: 1, providerFailures: 1, citationsFailed: 1 },
            provider: { statusClass: "unavailable", httpStatus: 503 },
        },
    });
    expect(JSON.stringify(f.sqlLog)).not.toContain("CONFIDENTIAL_SOURCE_MARKER");
    await expect(
        f.repository.completeProviderAttempt(actor, id, attempt, {
            statusClass: "success",
            httpStatus: 200,
        })
    ).rejects.toThrow("provider_attempt_already_settled");
});
it("atomically meters reported usage once, including a terminal non-OK attempt", async () => {
    const f = fixture();
    const identity = { owner: "deployment", route: "default", modelId: "synthetic" } as const;
    const known = await start(f);
    const unknown = await start(f, 2);
    const outcome = {
        statusClass: "unavailable",
        httpStatus: 503,
        usage: { inputTokens: 9, outputTokens: 4, totalTokens: 13, cachedInputTokens: 2 },
    };
    f.meter.mockRejectedValueOnce(new Error("meter_failed"));
    await expect(
        f.repository.completeProviderAttempt(actor, id, known, outcome, identity)
    ).rejects.toThrow("meter_failed");
    expect(f.state.attempts[0]).toMatchObject({ settled_at: null, outcome: null });
    expect(f.state.usage).toEqual([]);

    await f.repository.fail(actor, id, "provider_unavailable");
    await f.repository.completeProviderAttempt(actor, id, known, outcome, identity);
    await f.repository.completeProviderAttempt(actor, id, known, outcome, identity);
    await f.repository.completeProviderAttempt(
        actor,
        id,
        unknown,
        { statusClass: "unavailable", httpStatus: 503 },
        identity
    );

    expect(f.state.usage).toEqual([
        [
            1n,
            actor.userId,
            { ...identity, inputTokens: 9, outputTokens: 4, cachedInputTokens: 2 },
            undefined,
        ],
    ]);
    const status = await f.repository.status(actor, id);
    const unknownAttempt = status.providerAttempts.find(attempt => attempt.id === unknown);
    expect(unknownAttempt).toMatchObject({
        status: "settled",
        outcome: { usage: { totalTokens: null } },
    });
});
it("serializes concurrent digest attempts and failure without losing rows or resurrecting the run", async () => {
    const f = fixture();
    Object.assign(f.state.row, {
        generation_dispatched: false,
        exploration_dispatched: false,
        snapshot_hash: null,
    });
    const [a, b] = await Promise.all(
        [1, 2].map(() =>
            f.repository.beginProviderAttempt(actor, id, {
                stage: "digest",
                attempt: 1,
                messageBytes: 30,
            })
        )
    );
    await Promise.all([
        f.repository.fail(actor, id, "topic_digest_failed:provider", { stage: "digest" }),
        f.repository.completeProviderAttempt(actor, id, a!, {
            statusClass: "success",
            httpStatus: 200,
        }),
        f.repository.completeProviderAttempt(actor, id, b!, {
            statusClass: "rate_limited",
            httpStatus: 429,
        }),
    ]);
    expect(f.state.row.status).toBe("failed");
    expect(f.state.attempts).toHaveLength(2);
    expect(f.state.attempts.every(a => a.settled_at != null)).toBe(true);
    expect(f.state.row.failure_record).toMatchObject({
        counts: { providerAttempts: 2, providerFailures: 1 },
    });
    await expect(
        f.repository.beginProviderAttempt(actor, id, {
            stage: "digest",
            attempt: 2,
            messageBytes: 30,
        })
    ).rejects.toThrow("review_not_reserved");
});
it("expires uncertain runs and retains pending attempts as unknown accounting", async () => {
    const f = fixture();
    await start(f);
    await f.repository.expireUncertain(actor, id);
    expect(f.state.trace).toBeNull();
    const result = await f.repository.status(actor, id);
    expect(result.failureRecord).toMatchObject({
        stage: "recovery",
        code: "dispatch_uncertain_expired",
        counts: { providerAttempts: 1 },
        provider: { statusClass: "unknown", usage: { totalTokens: null } },
    });
    expect(result.providerAttempts[0]?.status).toBe("pending");
});
it("lists legacy failures with a safe fallback and only issues SELECTs on owner reads", async () => {
    const f = fixture();
    Object.assign(f.state.row, {
        status: "failed",
        failure_code: "CONFIDENTIAL_SOURCE_MARKER",
        ciphertext: "legacy-ciphertext",
        key_version: 8,
    });
    expect((await f.repository.list(actor))[0]?.failureRecord).toMatchObject({
        stage: "unknown",
        code: "candidate_not_admitted",
        counts: { evidenceBytes: null },
    });
    const status = await f.repository.status(actor, id);
    expect(status.failureRecord?.code).toBe("candidate_not_admitted");
    await f.repository.findByKey(actor, "2026-11-16", "legacy-key");
    await expect(f.repository.status({ ...actor, userId: "colleague" }, id)).rejects.toThrow(
        "review_not_found"
    );
    await expect(f.repository.status({ ...actor, companyId: "2" }, id)).rejects.toThrow(
        "review_not_found"
    );
    expect(f.state.row).toMatchObject({
        ciphertext: "legacy-ciphertext",
        key_version: 8,
        failure_record: null,
    });
    expect(f.state.trace).toEqual({ synthetic: true });
    const reads = f.sqlLog.filter(item => !item.sql.startsWith("SET "));
    expect(reads).toHaveLength(6);
    expect(
        reads.every(item => item.sql.startsWith("SELECT ") && !item.sql.includes("FOR UPDATE"))
    ).toBe(true);
    expect(JSON.stringify(status)).not.toContain("legacy-ciphertext");
    expect(JSON.stringify(status)).not.toContain("CONFIDENTIAL_SOURCE_MARKER");
});
it("does not overwrite accepted or already failed diagnostics with a late failure", async () => {
    const f = fixture();
    await f.repository.fail(actor, id, "invalid_source_citation", {
        stage: "generation_validation",
        counts: { citationsFailed: 1 },
    });
    const first = structuredClone(f.state.row.failure_record);
    await f.repository.fail(actor, id, "provider_timeout", { stage: "judge" });
    expect(f.state.row.failure_record).toEqual(first);
    Object.assign(f.state.row, {
        status: "accepted",
        ciphertext: "sealed",
        key_version: 1,
        failure_record: null,
    });
    await f.repository.fail(actor, id, "provider_timeout");
    expect(f.state.row).toMatchObject({
        status: "accepted",
        ciphertext: "sealed",
        key_version: 1,
        failure_record: null,
    });
});
it("bounds owner-visible ledger pages without dropping persisted accounting", async () => {
    const f = fixture();
    for (let i = 0; i < 260; i++)
        f.state.attempts.push({
            id,
            stage: "digest",
            attempt_ordinal: 1,
            message_bytes: 0,
            started_at: new Date().toISOString(),
            settled_at: null,
            outcome: null,
        });
    const response = await f.repository.status(actor, id);
    expect(response.providerAttempts).toHaveLength(256);
    expect(response.providerAttemptsTruncated).toBe(true);
    expect(f.state.attempts).toHaveLength(260);
});
it("rejects unreserved stages, expired deadlines and cross-owner settlements", async () => {
    const f = fixture();
    f.state.row.generation_dispatched = false;
    await expect(start(f)).rejects.toThrow("dispatch_already_reserved_or_invalid_order");
    f.state.row.generation_dispatched = true;
    await expect(
        f.repository.beginProviderAttempt(actor, id, {
            stage: "generation",
            attempt: 1,
            messageBytes: 1,
            snapshotHash: "snapshot",
            deadlineAt: Date.now() - 1,
        })
    ).rejects.toThrow("provider_attempt_timeout");
    const attempt = await start(f);
    await expect(
        f.repository.completeProviderAttempt({ ...actor, userId: "other" }, id, attempt, {
            statusClass: "success",
            httpStatus: 200,
        })
    ).rejects.toThrow("review_not_found");
    expect(f.state.attempts[0]?.outcome).toBeNull();
});
