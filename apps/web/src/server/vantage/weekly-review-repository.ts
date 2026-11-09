import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { decryptSecret, encryptSecret } from "@launchstack/store/crypto";
import {
    WeeklyReviewConflict,
    type AssertWeeklyReviewAuthority,
    type FrozenDependency,
    type WeeklyReviewActor,
    type WeeklyReviewDatabase,
    type WeeklyReviewQuery,
} from "./weekly-review-types";

const StoredReportSchema = z
    .object({
        schema: z.literal("vantage-weekly-review/v2.1"),
        id: z.string().min(1),
        companyId: z.string().min(1),
        ownerId: z.string().min(1),
        report: z
            .object({ topics: z.array(z.object({ id: z.string().min(1) }).passthrough()) })
            .passthrough(),
        evidence: z.unknown(),
    })
    .strict();
const StoredDecisionSchema = z
    .object({
        key: z.string().min(1),
        expectedVersion: z.number().int().positive(),
        topicId: z.string().min(1),
        decision: z.string().min(1),
        outcome: z.string().optional(),
        actorId: z.string().min(1),
        version: z.number().int().positive(),
        recordedAt: z.string().datetime(),
    })
    .strict();
export type StoredWeeklyReview = z.infer<typeof StoredReportSchema>;
export type StoredWeeklyReviewDecision = z.infer<typeof StoredDecisionSchema>;
export type ReadWeeklyReview = StoredWeeklyReview & {
    version: number;
    decisions: StoredWeeklyReviewDecision[];
};
const parseStoredReport = (text: string): StoredWeeklyReview => {
    const raw: unknown = JSON.parse(text);
    return StoredReportSchema.parse(raw);
};
const parseStoredDecision = (text: string): StoredWeeklyReviewDecision => {
    const raw: unknown = JSON.parse(text);
    return StoredDecisionSchema.parse(raw);
};
const scalarText = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number" || typeof value === "bigint")
        return String(value);
    if (value instanceof Date) return value.toISOString();
    throw new WeeklyReviewConflict("review_storage_corrupt", 500);
};
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const dependenciesOf = (row: Record<string, unknown>) =>
    (typeof row.dependencies === "string"
        ? JSON.parse(row.dependencies)
        : row.dependencies) as FrozenDependency[];
const requireRow = (rows: Record<string, unknown>[]) => {
    if (!rows[0]) throw new WeeklyReviewConflict("review_not_found", 404);
    return rows[0];
};
export function createWeeklyReviewRepository(
    database: WeeklyReviewDatabase,
    authority: AssertWeeklyReviewAuthority
) {
    const transact = async <T>(work: (query: WeeklyReviewQuery) => Promise<T>): Promise<T> => {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                return await database.transaction(async query => {
                    await query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
                    await query("SET LOCAL lock_timeout='1000ms'");
                    await query("SET LOCAL statement_timeout='5000ms'");
                    return work(query);
                });
            } catch (error) {
                const value = error as { code?: string; cause?: { code?: string } };
                const code = value.code ?? value.cause?.code;
                if (code === "40001" || code === "40P01") {
                    if (attempt < 2) continue;
                    throw new WeeklyReviewConflict("review_concurrent_update");
                }
                if (code === "55P03" || code === "57014")
                    throw new WeeklyReviewConflict("review_lock_unavailable", 503);
                throw error;
            }
        }
        throw new WeeklyReviewConflict("review_concurrent_update");
    };
    const rowFor = async (
        query: WeeklyReviewQuery,
        actor: WeeklyReviewActor,
        id: string,
        lock = false
    ) =>
        requireRow(
            await query(
                "SELECT * FROM pdr_ai_v2_vantage_weekly_review_runs WHERE id=$1::uuid AND company_id=$2::bigint AND owner_id=$3" +
                    (lock ? " FOR UPDATE" : ""),
                [id, actor.companyId, actor.userId]
            )
        );
    return {
        expireUncertain(actor: WeeklyReviewActor, id: string) {
            return transact(async query => {
                const row = await rowFor(query, actor, id, true);
                await authority(query, actor, [], "recovery");
                if (row.status !== "reserved")
                    return { id, status: String(row.status), expired: false };
                const changed = await query(
                    "UPDATE pdr_ai_v2_vantage_weekly_review_runs SET status='failed',failure_code='dispatch_uncertain_expired' WHERE id=$1::uuid AND status='reserved' AND created_at<=now()-interval '120 seconds' RETURNING id",
                    [id]
                );
                if (!changed.length)
                    throw new WeeklyReviewConflict("review_reservation_not_expired");
                return { id, status: "failed", expired: true };
            });
        },
        restore(
            actor: WeeklyReviewActor,
            id: string,
            input: { expectedActiveId: string | null; key: string }
        ) {
            return transact(async query => {
                const row = await rowFor(query, actor, id, true);
                if (row.status !== "accepted")
                    throw new WeeklyReviewConflict("review_not_accepted");
                await authority(query, actor, dependenciesOf(row), "decision");
                const digest = hash({ id, expectedActiveId: input.expectedActiveId });
                await query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
                    actor.companyId + ":" + actor.userId + ":" + scalarText(row.week_start),
                ]);
                const replay = await query(
                    "SELECT id,payload_hash,run_id FROM pdr_ai_v2_vantage_weekly_review_activation_events WHERE company_id=$1::bigint AND owner_id=$2 AND idempotency_key=$3",
                    [actor.companyId, actor.userId, input.key]
                );
                if (replay[0]) {
                    if (replay[0].payload_hash !== digest)
                        throw new WeeklyReviewConflict("idempotency_conflict");
                    return { id: String(replay[0].id), runId: id, replayed: true };
                }
                const current = await query(
                    "SELECT run_id FROM pdr_ai_v2_vantage_weekly_review_active WHERE company_id=$1::bigint AND owner_id=$2 AND week_start=$3::date",
                    [actor.companyId, actor.userId, row.week_start]
                );
                if ((current[0]?.run_id ?? null) !== input.expectedActiveId)
                    throw new WeeklyReviewConflict("active_review_changed");
                const eventId = randomUUID();
                await query(
                    "INSERT INTO pdr_ai_v2_vantage_weekly_review_activation_events(id,company_id,owner_id,week_start,actor_id,idempotency_key,payload_hash,kind,previous_run_id,run_id) VALUES($1::uuid,$2::bigint,$3,$4::date,$5,$6,$7,'restored',$8::uuid,$9::uuid)",
                    [
                        eventId,
                        actor.companyId,
                        actor.userId,
                        row.week_start,
                        actor.userId,
                        input.key,
                        digest,
                        input.expectedActiveId,
                        id,
                    ]
                );
                await query(
                    "INSERT INTO pdr_ai_v2_vantage_weekly_review_active(company_id,owner_id,week_start,run_id) VALUES($1::bigint,$2,$3::date,$4::uuid) ON CONFLICT(company_id,owner_id,week_start) DO UPDATE SET run_id=EXCLUDED.run_id",
                    [actor.companyId, actor.userId, row.week_start, id]
                );
                return { id: eventId, runId: id, replayed: false };
            });
        },
        active(actor: WeeklyReviewActor, week: string) {
            return transact(async query => {
                const rows = await query(
                    "SELECT run_id FROM pdr_ai_v2_vantage_weekly_review_active WHERE company_id=$1::bigint AND owner_id=$2 AND week_start=$3::date",
                    [actor.companyId, actor.userId, week]
                );
                return rows[0]?.run_id ? scalarText(rows[0].run_id) : null;
            });
        },
        reserve(
            actor: WeeklyReviewActor,
            week: string,
            key: string,
            inputHash: string,
            dependencies: FrozenDependency[]
        ) {
            return transact(async query => {
                await authority(query, actor, dependencies, "prepare");
                const rows = await query(
                    "INSERT INTO pdr_ai_v2_vantage_weekly_review_runs(id,company_id,owner_id,week_start,idempotency_key,input_hash,status,dependencies) VALUES($1::uuid,$2::bigint,$3,$4::date,$5,$6,'reserved',$7::jsonb) ON CONFLICT(company_id,owner_id,idempotency_key) DO NOTHING RETURNING *",
                    [
                        randomUUID(),
                        actor.companyId,
                        actor.userId,
                        week,
                        key,
                        inputHash,
                        JSON.stringify(dependencies),
                    ]
                );
                const row =
                    rows[0] ??
                    requireRow(
                        await query(
                            "SELECT * FROM pdr_ai_v2_vantage_weekly_review_runs WHERE company_id=$1::bigint AND owner_id=$2 AND idempotency_key=$3",
                            [actor.companyId, actor.userId, key]
                        )
                    );
                if (
                    row.input_hash !== inputHash ||
                    (row.week_start instanceof Date
                        ? row.week_start.toISOString().slice(0, 10)
                        : scalarText(row.week_start).slice(0, 10)) !== week
                )
                    throw new WeeklyReviewConflict("idempotency_conflict");
                return { id: String(row.id), status: String(row.status), created: !!rows[0] };
            });
        },
        /** The dispatch linearization point: authority checked and reservation locked.
         * Never hold this transaction through an external HTTP request. */
        authorizeDispatch(
            actor: WeeklyReviewActor,
            id: string,
            kind: "generation" | "judge" = "generation"
        ) {
            return transact(async query => {
                const row = await rowFor(query, actor, id, true);
                if (row.status !== "reserved")
                    throw new WeeklyReviewConflict("review_not_reserved");
                await authority(query, actor, dependenciesOf(row), "dispatch");
                if (row[kind + "_dispatched"] || (kind === "judge" && !row.generation_dispatched))
                    throw new WeeklyReviewConflict("dispatch_already_reserved_or_invalid_order");
                await query(
                    "UPDATE pdr_ai_v2_vantage_weekly_review_runs SET " +
                        kind +
                        "_dispatched=true WHERE id=$1::uuid",
                    [id]
                );
            });
        },
        fail(actor: WeeklyReviewActor, id: string, code: string) {
            return transact(async query => {
                await rowFor(query, actor, id, true);
                await query(
                    "UPDATE pdr_ai_v2_vantage_weekly_review_runs SET status='failed',failure_code=$4 WHERE id=$1::uuid AND company_id=$2::bigint AND owner_id=$3 AND status='reserved'",
                    [id, actor.companyId, actor.userId, code]
                );
            });
        },
        accept(
            actor: WeeklyReviewActor,
            id: string,
            input: { report: unknown; evidence: unknown; expectedActiveId: string | null }
        ) {
            return transact(async query => {
                const row = await rowFor(query, actor, id, true);
                if (row.status !== "reserved")
                    throw new WeeklyReviewConflict("review_not_reserved");
                await authority(query, actor, dependenciesOf(row), "activation");
                await query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
                    actor.companyId + ":" + actor.userId + ":" + scalarText(row.week_start),
                ]);
                const active = await query(
                    "SELECT run_id FROM pdr_ai_v2_vantage_weekly_review_active WHERE company_id=$1::bigint AND owner_id=$2 AND week_start=$3::date",
                    [actor.companyId, actor.userId, row.week_start]
                );
                if ((active[0]?.run_id ?? null) !== input.expectedActiveId)
                    throw new WeeklyReviewConflict("active_review_changed");
                if (!row.generation_dispatched || !row.judge_dispatched)
                    throw new WeeklyReviewConflict("unjudged_candidate");
                const evidence = input.evidence as {
                    schemaVersion?: string;
                    candidateId?: string;
                    reportHash?: string;
                    inputHash?: string;
                    evaluationHash?: string;
                    evaluation?: {
                        status?: string;
                        verdict?: string;
                        error?: unknown;
                        integrityIssues?: { severity?: string }[];
                    };
                } | null;
                if (
                    !evidence ||
                    evidence.schemaVersion !== "vantage-admission/v1" ||
                    evidence.candidateId !== id ||
                    evidence.reportHash !== hash(input.report) ||
                    !/^[a-f0-9]{64}$/.test(evidence.inputHash ?? "") ||
                    !/^[a-f0-9]{64}$/.test(evidence.evaluationHash ?? "") ||
                    evidence.evaluation?.status !== "assessed" ||
                    evidence.evaluation.verdict !== "pass" ||
                    evidence.evaluation.error ||
                    !Array.isArray(evidence.evaluation.integrityIssues) ||
                    evidence.evaluation.integrityIssues.some(issue => issue.severity === "error")
                )
                    throw new WeeklyReviewConflict("candidate_admission_invalid");
                const envelope = {
                    schema: "vantage-weekly-review/v2.1",
                    id,
                    companyId: actor.companyId,
                    ownerId: actor.userId,
                    report: input.report,
                    evidence: input.evidence,
                };
                const sealed = encryptSecret(
                    JSON.stringify(envelope),
                    "vantage-report:" + actor.companyId + ":" + actor.userId + ":" + id
                );
                await query(
                    "UPDATE pdr_ai_v2_vantage_weekly_review_runs SET status='accepted',ciphertext=$2,key_version=$3,accepted_at=now() WHERE id=$1::uuid",
                    [id, sealed.ciphertext, sealed.keyVersion]
                );
                await query(
                    "INSERT INTO pdr_ai_v2_vantage_weekly_review_active(company_id,owner_id,week_start,run_id) VALUES($1::bigint,$2,$3::date,$4::uuid) ON CONFLICT(company_id,owner_id,week_start) DO UPDATE SET run_id=EXCLUDED.run_id",
                    [actor.companyId, actor.userId, row.week_start, id]
                );
                await query(
                    "INSERT INTO pdr_ai_v2_vantage_weekly_review_activation_events(id,company_id,owner_id,week_start,actor_id,idempotency_key,payload_hash,kind,previous_run_id,run_id) VALUES($1::uuid,$2::bigint,$3,$4::date,$5,$6,$7,'accepted',$8::uuid,$9::uuid)",
                    [
                        randomUUID(),
                        actor.companyId,
                        actor.userId,
                        row.week_start,
                        actor.userId,
                        "accept:" + id,
                        hash({ id, expectedActiveId: input.expectedActiveId }),
                        input.expectedActiveId,
                        id,
                    ]
                );
                return id;
            });
        },
        get(actor: WeeklyReviewActor, id: string): Promise<ReadWeeklyReview> {
            return transact(async query => {
                const row = await rowFor(query, actor, id);
                if (row.status !== "accepted")
                    throw new WeeklyReviewConflict("review_not_accepted", 404);
                await authority(query, actor, dependenciesOf(row), "read");
                const payload = parseStoredReport(
                    decryptSecret(
                        String(row.ciphertext),
                        "vantage-report:" + actor.companyId + ":" + actor.userId + ":" + id
                    )
                );
                if (
                    payload.id !== id ||
                    payload.companyId !== actor.companyId ||
                    payload.ownerId !== actor.userId ||
                    payload.schema !== row.schema_version
                )
                    throw new WeeklyReviewConflict("review_identity_invalid", 403);
                const decisions = await query(
                    "SELECT ciphertext FROM pdr_ai_v2_vantage_weekly_review_decisions WHERE company_id=$1::bigint AND run_id=$2::uuid ORDER BY version",
                    [actor.companyId, id]
                );
                return {
                    ...payload,
                    version: Number(row.review_version),
                    decisions: decisions.map(item =>
                        parseStoredDecision(decryptSecret(String(item.ciphertext)))
                    ),
                };
            });
        },
        list(actor: WeeklyReviewActor) {
            return transact(query =>
                query(
                    "SELECT id,week_start,status,review_version,created_at FROM pdr_ai_v2_vantage_weekly_review_runs WHERE company_id=$1::bigint AND owner_id=$2 ORDER BY created_at DESC LIMIT 52",
                    [actor.companyId, actor.userId]
                )
            );
        },
        decide(
            actor: WeeklyReviewActor,
            id: string,
            input: {
                key: string;
                expectedVersion: number;
                topicId: string;
                decision: string;
                outcome?: string;
            }
        ) {
            return transact(async query => {
                const row = await rowFor(query, actor, id, true);
                if (row.status !== "accepted")
                    throw new WeeklyReviewConflict("review_not_accepted");
                await authority(query, actor, dependenciesOf(row), "decision");
                const digest = hash(input);
                const old = await query(
                    "SELECT payload_hash,version FROM pdr_ai_v2_vantage_weekly_review_decisions WHERE company_id=$1::bigint AND run_id=$2::uuid AND actor_id=$3 AND idempotency_key=$4",
                    [actor.companyId, id, actor.userId, input.key]
                );
                if (old[0]) {
                    if (old[0].payload_hash !== digest)
                        throw new WeeklyReviewConflict("idempotency_conflict");
                    return Number(old[0].version);
                }
                if (Number(row.review_version) !== input.expectedVersion)
                    throw new WeeklyReviewConflict("stale_review");
                const payload = parseStoredReport(
                    decryptSecret(
                        String(row.ciphertext),
                        "vantage-report:" + actor.companyId + ":" + actor.userId + ":" + id
                    )
                );
                const topics = payload.report?.topics;
                if (
                    !Array.isArray(topics) ||
                    !topics.some((topic: { id?: string }) => topic.id === input.topicId)
                )
                    throw new WeeklyReviewConflict("topic_not_found", 404);
                const version = Number(row.review_version) + 1;
                await query(
                    "INSERT INTO pdr_ai_v2_vantage_weekly_review_decisions(id,company_id,run_id,actor_id,idempotency_key,payload_hash,ciphertext,version) VALUES($1::uuid,$2::bigint,$3::uuid,$4,$5,$6,$7,$8)",
                    [
                        randomUUID(),
                        actor.companyId,
                        id,
                        actor.userId,
                        input.key,
                        digest,
                        encryptSecret(
                            JSON.stringify({
                                ...input,
                                actorId: actor.userId,
                                version,
                                recordedAt: new Date().toISOString(),
                            })
                        ).ciphertext,
                        version,
                    ]
                );
                await query(
                    "UPDATE pdr_ai_v2_vantage_weekly_review_runs SET review_version=$2 WHERE id=$1::uuid",
                    [id, version]
                );
                return version;
            });
        },
    };
}
