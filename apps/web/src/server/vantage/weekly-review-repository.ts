import {
    fingerprint,
    SCOPED_EVALUATION_VERSION,
    SCOPED_RUBRIC_VERSION,
} from "@launchstack/pipelines/vantage/weekly-review-validation";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { ChatProviderAttemptUsageIdentity } from "@launchstack/llm";
import { createSlot } from "@launchstack/runtime/slot";
import { decryptSecret, encryptSecret } from "@launchstack/store/crypto";
import {
    calculateWeeklyReviewBudget,
    weeklyReviewEvaluation,
    weeklyReviewAdmissionBytes,
    validateScopedWeeklyReviewInput,
    type WeeklyReviewV21,
    type WeeklyReviewInput,
} from "@launchstack/pipelines/vantage/weekly-review-v21";
import {
    WeeklyReviewConflict,
    type AssertWeeklyReviewAuthority,
    type FrozenDependency,
    type WeeklyReviewActor,
    type WeeklyReviewDatabase,
    type WeeklyReviewQuery,
} from "./weekly-review-types";

import { matchesOffer, type TopicFreeze } from "./weekly-review-topic-freeze";
import { minimizeExplorationTrace } from "./weekly-review-topic-exploration";
import {
    TOPIC_FIRST_LIMITS,
    topicInputHash,
    topicManifestHash,
    type TopicManifest,
} from "./weekly-review-topic-types";
import {
    PROVIDER_ATTEMPT_STAGES,
    safeReviewCount,
    safeWeeklyReviewProviderOutcome,
    weeklyReviewFailureRecord,
    weeklyReviewProviderAttempt,
    type WeeklyReviewFailureInput,
    type WeeklyReviewProviderAttemptInput,
} from "./weekly-review-failure-record";
import { recordWeeklyReviewAttemptUsage } from "./weekly-review-attempt-usage";

const WeeklyReviewV21SchemaForCarryover = z.object({
    topics: z.array(
        z.object({
            id: z.string(),
            facts: z.array(z.object({ refs: z.array(z.string()) })),
            conflicts: z.array(z.object({ refs: z.array(z.string()) })),
            recommendation: z.object({ refs: z.array(z.string()) }).nullable(),
        })
    ),
});
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
/** Omitted sources are not read-authority dependencies. Keep their identifiers
 * only in the encrypted admission record, even if access was allowed at capture. */
function reportReadEvidence(value: unknown, topicRun: boolean): unknown {
    if (!value || typeof value !== "object") return value;
    const evidence = value as Record<string, unknown>;
    if (topicRun) {
        const snapshot = evidence.inputSnapshot as WeeklyReviewInput | undefined;
        const context = snapshot?.retrievalContext;
        if (!snapshot || context?.schemaVersion !== "vantage-topic-retrieval/v1") return null;
        const publicSnapshot = {
            candidateId: snapshot.candidateId,
            week: snapshot.week,
            asOf: snapshot.asOf,
            role: snapshot.role,
            mandatoryCoverage: snapshot.mandatoryCoverage,
            sources: snapshot.sources,
            scopedEvidence: snapshot.scopedEvidence,
        };
        return {
            schemaVersion: evidence.schemaVersion,
            inputSnapshot: publicSnapshot,
            sourceRegistry: snapshot.sources.map(({ ref, version, hash, purpose, title }) => ({
                ref,
                version,
                hash,
                purpose,
                title,
            })),
            qualityEvidence: evidence.qualityEvidence,
            scopedEvidence: snapshot.scopedEvidence,
            budget: evidence.budget,
            retrievalMode: "topic-first",
            topicRetrieval: {
                mode: context.mode,
                lane: context.lane,
                seedReasons: context.seedReasons,
                outcome: context.degradation ? "degraded" : "frozen",
                ...(context.degradation ? { degradation: context.degradation } : {}),
            },
        };
    }
    if (
        !["vantage-admission/v2", "vantage-admission/v3"].includes(
            String(evidence.schemaVersion)
        ) ||
        !evidence.selectionDiagnostics ||
        typeof evidence.selectionDiagnostics !== "object"
    )
        return value;
    const { omitted, dynamicRetrieval, ...diagnostics } = evidence.selectionDiagnostics as Record<
        string,
        unknown
    >;
    // Discovery may include sources that were never frozen and later became private.
    // Preserve the full encrypted trace while exposing only aggregate discovery metadata.
    const dynamic =
        dynamicRetrieval && typeof dynamicRetrieval === "object"
            ? (dynamicRetrieval as Record<string, unknown>)
            : undefined;
    // Historical traces may repeat the same omission across selection passes.
    const uniqueOmitted = Array.isArray(omitted)
        ? [
              ...new Map(
                  omitted.map((item: unknown, index: number) => {
                      const entry =
                          item && typeof item === "object"
                              ? (item as Record<string, unknown>)
                              : undefined;
                      return [
                          entry && typeof entry.id === "string"
                              ? JSON.stringify([entry.id, entry.version ?? null])
                              : index,
                          item,
                      ];
                  })
              ).values(),
          ]
        : [];
    const publicDecision = (value: unknown): unknown => {
        if (!value || typeof value !== "object") return value;
        const decision = value as Record<string, unknown>;
        const withoutRefs = (gaps: unknown) =>
            Array.isArray(gaps)
                ? gaps.map((gap: unknown) => {
                      if (!gap || typeof gap !== "object") return gap;
                      const publicGap = { ...(gap as Record<string, unknown>) };
                      delete publicGap.supportingRefs;
                      return publicGap;
                  })
                : gaps;
        return {
            ...decision,
            gaps: withoutRefs(decision.gaps),
            unresolved: withoutRefs(decision.unresolved),
        };
    };
    const followUp =
        dynamic?.followUp && typeof dynamic.followUp === "object"
            ? (dynamic.followUp as Record<string, unknown>)
            : undefined;
    const omissionReasonCounts: Record<string, number> = {};
    for (const item of uniqueOmitted) {
        if (item && typeof item === "object" && "reason" in item && typeof item.reason === "string")
            omissionReasonCounts[item.reason] = (omissionReasonCounts[item.reason] ?? 0) + 1;
    }
    return {
        ...evidence,
        selectionDiagnostics: {
            ...diagnostics,
            ...(dynamic
                ? {
                      dynamicRetrieval: {
                          schemaVersion: dynamic.schemaVersion,
                          mode: dynamic.mode,
                          roleStatus: dynamic.roleStatus,
                          roleRevision: dynamic.roleRevision,
                          rankingCandidateCount:
                              typeof dynamic.rankingCandidateCount === "number"
                                  ? dynamic.rankingCandidateCount
                                  : Array.isArray(dynamic.ranking)
                                    ? dynamic.ranking.length
                                    : 0,
                          bounds: dynamic.bounds,
                          decision: publicDecision(dynamic.decision),
                          finalDecision: publicDecision(dynamic.finalDecision),
                          followUp: followUp
                              ? {
                                    rounds: followUp.rounds,
                                    queryCount: followUp.queryCount,
                                    // Older persisted acquiredCount included cached matches.
                                    // Preserve its historical value without relabeling it as new.
                                    acquiredCount:
                                        typeof followUp.acquiredCount === "number"
                                            ? followUp.acquiredCount
                                            : Array.isArray(followUp.acquired)
                                              ? followUp.acquired.length
                                              : 0,
                                    ...Object.fromEntries(
                                        [
                                            "newlyAcquiredCount",
                                            "cachedMatchCount",
                                            "admittedCount",
                                            "admittedFromCacheCount",
                                        ]
                                            .filter(key => typeof followUp[key] === "number")
                                            .map(key => [key, followUp[key]])
                                    ),
                                }
                              : undefined,
                      },
                  }
                : {}),
            omittedCount: uniqueOmitted.length,
            omissionReasonCounts,
        },
    };
}
const dependenciesOf = (row: Record<string, unknown>) =>
    (typeof row.dependencies === "string"
        ? JSON.parse(row.dependencies)
        : row.dependencies) as FrozenDependency[];
const requireRow = (rows: Record<string, unknown>[]) => {
    if (!rows[0]) throw new WeeklyReviewConflict("review_not_found", 404);
    return rows[0];
};
const storedJson = (value: unknown): unknown => {
    if (typeof value !== "string") return value;
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return null;
    }
};
const failureOf = (row: Record<string, unknown>) =>
    row.status === "failed"
        ? weeklyReviewFailureRecord(row.failure_code, storedJson(row.failure_record))
        : null;
const runSummary = (row: Record<string, unknown>) => ({
    id: scalarText(row.id),
    week_start: scalarText(row.week_start).slice(0, 10),
    status: ["reserved", "accepted", "failed"].includes(String(row.status))
        ? String(row.status)
        : "unknown",
    review_version: safeReviewCount(row.review_version),
    created_at: row.created_at == null ? null : scalarText(row.created_at),
    failureRecord: failureOf(row),
});

// Route bundles and request-scoped repositories share the queue in each web process.
// Database locks, constraints, and SERIALIZABLE retries still fence other processes.
const mutationQueue = createSlot<Map<string, Promise<void>>>("vantage-weekly-review-mutations");

async function serializeMutation<T>(
    actor: WeeklyReviewActor,
    scope: "run" | "reservation",
    id: string,
    work: () => Promise<T>
): Promise<T> {
    const tails = mutationQueue.get() ?? new Map<string, Promise<void>>();
    mutationQueue.set(tails);
    const key = JSON.stringify([actor.companyId, actor.userId, scope, id]);
    const previous = tails.get(key);
    let release!: () => void;
    const tail = new Promise<void>(resolve => {
        release = resolve;
    });
    tails.set(key, tail);
    try {
        await previous;
        return await work();
    } finally {
        release();
        if (tails.get(key) === tail) tails.delete(key);
    }
}

export function createWeeklyReviewRepository(
    database: WeeklyReviewDatabase,
    authority: AssertWeeklyReviewAuthority
) {
    const transact = async <T>(
        work: (query: WeeklyReviewQuery) => Promise<T>,
        access?: "READ ONLY"
    ): Promise<T> => {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                return await database.transaction(async query => {
                    await query(
                        "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE" +
                            (access ? ", " + access : "")
                    );
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
    const runTransaction = <T>(
        actor: WeeklyReviewActor,
        id: string,
        work: (query: WeeklyReviewQuery) => Promise<T>
    ) =>
        // PostgreSQL accepts equivalent UUID spellings in path parameters.
        serializeMutation(actor, "run", id.replace(/[{}-]/g, "").toLowerCase(), () =>
            transact(work)
        );
    const reservationTransaction = <T>(
        actor: WeeklyReviewActor,
        key: string,
        work: (query: WeeklyReviewQuery) => Promise<T>
    ) => serializeMutation(actor, "reservation", key, () => transact(work));
    const clearTerminalTrace = (query: WeeklyReviewQuery, id: string) =>
        query(
            "UPDATE pdr_ai_v2_vantage_weekly_review_run_manifests SET trace=NULL WHERE run_id=$1::uuid AND trace IS NOT NULL",
            [id]
        );
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
    const topicAuthority = (
        query: WeeklyReviewQuery,
        actor: WeeklyReviewActor,
        row: Record<string, unknown>
    ) =>
        authority(
            query,
            { ...actor, authorityEpoch: String(row.authority_epoch) },
            [],
            "exploration"
        );
    const parseManifest = async (query: WeeklyReviewQuery, id: string) => {
        const record = requireRow(
            await query(
                "SELECT * FROM pdr_ai_v2_vantage_weekly_review_run_manifests WHERE run_id=$1::uuid",
                [id]
            )
        );
        const manifest = record.manifest as TopicManifest;
        if (record.manifest_hash !== topicManifestHash(manifest))
            throw new WeeklyReviewConflict("candidate_admission_invalid");
        return { record, manifest };
    };
    const checkedManifest = async (
        query: WeeklyReviewQuery,
        id: string,
        row: Record<string, unknown>
    ) => {
        const result = await parseManifest(query, id);
        if (row.input_hash !== topicInputHash(result.manifest))
            throw new WeeklyReviewConflict("candidate_admission_invalid");
        return result;
    };
    const attemptAccounting = async (
        query: WeeklyReviewQuery,
        actor: WeeklyReviewActor,
        id: string
    ) => {
        const [totals] = await query(
            "SELECT count(*)::int AS attempts,count(*) FILTER (WHERE outcome IS NOT NULL AND outcome->>'statusClass'<>'success')::int AS failures FROM pdr_ai_v2_vantage_weekly_review_provider_attempts WHERE company_id=$1::bigint AND owner_id=$2 AND run_id=$3::uuid",
            [actor.companyId, actor.userId, id]
        );
        const [latest] = await query(
            "SELECT outcome,stage,message_bytes FROM pdr_ai_v2_vantage_weekly_review_provider_attempts WHERE company_id=$1::bigint AND owner_id=$2 AND run_id=$3::uuid ORDER BY started_at DESC,id DESC LIMIT 1",
            [actor.companyId, actor.userId, id]
        );
        return {
            totals,
            provider: safeWeeklyReviewProviderOutcome(storedJson(latest?.outcome)),
            stage: PROVIDER_ATTEMPT_STAGES.find(stage => stage === latest?.stage),
            messageBytes: safeReviewCount(latest?.message_bytes),
        };
    };
    const checkedRetryDispatch = async (
        query: WeeklyReviewQuery,
        actor: WeeklyReviewActor,
        id: string,
        row: Record<string, unknown>,
        kind: "generation" | "judge",
        expectedActiveId?: string | null,
        snapshotHash?: string
    ) => {
        if (row.status !== "reserved") throw new WeeklyReviewConflict("review_not_reserved");
        if (
            !row[kind + "_dispatched"] ||
            !row.generation_dispatched ||
            (kind === "generation" && row.judge_dispatched)
        )
            throw new WeeklyReviewConflict("dispatch_already_reserved_or_invalid_order");
        if (
            row.retrieval_mode === "topic_first" &&
            (!row.snapshot_hash || row.snapshot_hash !== snapshotHash)
        )
            throw new WeeklyReviewConflict("candidate_admission_invalid");
        await authority(query, actor, dependenciesOf(row), "dispatch");
        if (kind === "generation" && expectedActiveId !== undefined) {
            const active = await query(
                "SELECT run_id FROM pdr_ai_v2_vantage_weekly_review_active WHERE company_id=$1::bigint AND owner_id=$2 AND week_start=$3::date",
                [actor.companyId, actor.userId, row.week_start]
            );
            if ((active[0]?.run_id ?? null) !== expectedActiveId)
                throw new WeeklyReviewConflict("active_review_changed");
        }
    };
    return {
        findByKey(actor: WeeklyReviewActor, week: string, key: string) {
            return transact(async query => {
                const [row] = await query(
                    "SELECT id,week_start,status FROM pdr_ai_v2_vantage_weekly_review_runs WHERE company_id=$1::bigint AND owner_id=$2 AND idempotency_key=$3",
                    [actor.companyId, actor.userId, key]
                );
                if (!row) return null;
                if (scalarText(row.week_start).slice(0, 10) !== week)
                    throw new WeeklyReviewConflict("idempotency_conflict");
                return { id: String(row.id), status: String(row.status) };
            }, "READ ONLY");
        },
        reserveTopic(actor: WeeklyReviewActor, key: string, id: string, manifest: TopicManifest) {
            return reservationTransaction(actor, key, async query => {
                const rows = await query(
                    `
                    INSERT INTO pdr_ai_v2_vantage_weekly_review_runs
                        (id,company_id,owner_id,week_start,idempotency_key,input_hash,status,dependencies,
                         retrieval_mode,pinned_cutoff,pinned_as_of,authority_epoch)
                    VALUES ($1::uuid,$2::bigint,$3,$4::date,$5,$6,'reserved',$7::jsonb,
                            'topic_first',$8::timestamptz,$9::timestamptz,$10)
                    ON CONFLICT(company_id,owner_id,idempotency_key) DO NOTHING RETURNING id,status
                `,
                    [
                        id,
                        actor.companyId,
                        actor.userId,
                        manifest.week,
                        key,
                        topicInputHash(manifest),
                        JSON.stringify(manifest.fixedDependencies),
                        manifest.cutoff,
                        manifest.asOf,
                        manifest.epoch,
                    ]
                );
                if (rows.length) {
                    await query(
                        `
                        INSERT INTO pdr_ai_v2_vantage_weekly_review_run_manifests
                            (run_id,company_id,owner_id,manifest_hash,manifest)
                        VALUES ($1::uuid,$2::bigint,$3,$4,$5::jsonb)
                    `,
                        [
                            id,
                            actor.companyId,
                            actor.userId,
                            topicManifestHash(manifest),
                            JSON.stringify(manifest),
                        ]
                    );
                    return { id, status: "reserved", created: true };
                }
                const row = requireRow(
                    await query(
                        "SELECT id,week_start,status FROM pdr_ai_v2_vantage_weekly_review_runs WHERE company_id=$1::bigint AND owner_id=$2 AND idempotency_key=$3",
                        [actor.companyId, actor.userId, key]
                    )
                );
                if (scalarText(row.week_start).slice(0, 10) !== manifest.week)
                    throw new WeeklyReviewConflict("idempotency_conflict");
                return { id: String(row.id), status: String(row.status), created: false };
            });
        },
        beginDigestPreparation(actor: WeeklyReviewActor, id: string) {
            return runTransaction(actor, id, async query => {
                const row = await rowFor(query, actor, id, true);
                if (
                    row.status !== "reserved" ||
                    row.retrieval_mode !== "topic_first" ||
                    row.exploration_dispatched
                )
                    throw new WeeklyReviewConflict("review_not_reserved");
                await topicAuthority(query, actor, row);
                await checkedManifest(query, id, row);
                await query(
                    "UPDATE pdr_ai_v2_vantage_weekly_review_runs SET last_dispatch_at=clock_timestamp() WHERE id=$1::uuid",
                    [id]
                );
                await query(
                    "UPDATE pdr_ai_v2_vantage_weekly_review_run_manifests SET trace=COALESCE(trace,'{}'::jsonb)||jsonb_build_object('stages',COALESCE(trace->'stages','{}'::jsonb)||$2::jsonb) WHERE run_id=$1::uuid",
                    [id, JSON.stringify({ digestStartedAt: new Date().toISOString() })]
                );
            });
        },
        recordDigestPreparation(
            actor: WeeklyReviewActor,
            id: string,
            values: {
                digestIds?: string[];
                timing: {
                    digestStartedAt?: string;
                    digestCompletedAt: string;
                    digestDurationMs: number;
                    digestOutcome: "ready" | "failed";
                };
            }
        ) {
            return runTransaction(actor, id, async query => {
                const row = await rowFor(query, actor, id, true);
                if (
                    row.status !== "reserved" ||
                    row.retrieval_mode !== "topic_first" ||
                    row.exploration_dispatched
                )
                    throw new WeeklyReviewConflict("review_not_reserved");
                await query(
                    "UPDATE pdr_ai_v2_vantage_weekly_review_run_manifests SET digest_ids=COALESCE($2::jsonb,digest_ids),trace=COALESCE(trace,'{}'::jsonb)||jsonb_build_object('stages',COALESCE(trace->'stages','{}'::jsonb)||$3::jsonb) WHERE run_id=$1::uuid",
                    [
                        id,
                        values.digestIds ? JSON.stringify(values.digestIds) : null,
                        JSON.stringify(values.timing),
                    ]
                );
            });
        },
        claimExploration(actor: WeeklyReviewActor, id: string) {
            return runTransaction(actor, id, async query => {
                const row = await rowFor(query, actor, id, true);
                if (
                    row.status !== "reserved" ||
                    row.retrieval_mode !== "topic_first" ||
                    row.exploration_dispatched
                )
                    throw new WeeklyReviewConflict("dispatch_already_reserved_or_invalid_order");
                await topicAuthority(query, actor, row);
                const { manifest } = await checkedManifest(query, id, row);
                const [active] = await query(
                    "SELECT run_id FROM pdr_ai_v2_vantage_weekly_review_active WHERE company_id=$1::bigint AND owner_id=$2 AND week_start=$3::date",
                    [actor.companyId, actor.userId, manifest.week]
                );
                if ((active?.run_id ?? null) !== manifest.expectedActiveId)
                    throw new WeeklyReviewConflict("active_review_changed");
                const [claimed] = await query(
                    `
                    UPDATE pdr_ai_v2_vantage_weekly_review_runs
                    SET exploration_dispatched=true, exploration_deadline_at=clock_timestamp()+($2::int*interval '1 millisecond'),
                        last_dispatch_at=clock_timestamp()
                    WHERE id=$1::uuid RETURNING exploration_deadline_at
                `,
                    [id, TOPIC_FIRST_LIMITS.explorationMs]
                );
                return Date.parse(scalarText(claimed?.exploration_deadline_at));
            });
        },
        freezeTopic(
            actor: WeeklyReviewActor,
            id: string,
            build: (query: WeeklyReviewQuery) => Promise<TopicFreeze>
        ) {
            return runTransaction(actor, id, async query => {
                const row = await rowFor(query, actor, id, true);
                if (
                    row.status !== "reserved" ||
                    row.retrieval_mode !== "topic_first" ||
                    !row.exploration_dispatched ||
                    row.snapshot_hash ||
                    row.generation_dispatched
                )
                    throw new WeeklyReviewConflict("dispatch_already_reserved_or_invalid_order");
                if (Date.now() >= Date.parse(scalarText(row.exploration_deadline_at)))
                    throw new WeeklyReviewConflict("topic_exploration_failed:timeout");
                await topicAuthority(query, actor, row);
                const { manifest } = await checkedManifest(query, id, row);
                await authority(query, actor, manifest.fixedDependencies, "dispatch");
                const frozen = await build(query);
                const snapshotHash = fingerprint(frozen.input);
                const updated = await query(
                    `
                    UPDATE pdr_ai_v2_vantage_weekly_review_runs
                    SET dependencies=$2::jsonb, snapshot_hash=$3, last_dispatch_at=clock_timestamp()
                    WHERE id=$1::uuid AND clock_timestamp() < exploration_deadline_at RETURNING id
                `,
                    [id, JSON.stringify(frozen.dependencies), snapshotHash]
                );
                if (!updated.length)
                    throw new WeeklyReviewConflict("topic_exploration_failed:timeout");
                await query(
                    "UPDATE pdr_ai_v2_vantage_weekly_review_run_manifests SET snapshot_commitment=$2::jsonb WHERE run_id=$1::uuid",
                    [
                        id,
                        JSON.stringify({
                            snapshotHash,
                            dependencyHash: fingerprint(frozen.dependencies),
                            ...(frozen.summary.degradation
                                ? { degradation: frozen.summary.degradation }
                                : {}),
                        }),
                    ]
                );
                return frozen;
            });
        },
        recordExploration(
            actor: WeeklyReviewActor,
            id: string,
            values: {
                trace?: unknown;
                digestIds?: string[];
                timing?: { explorationStartedAt?: string; explorationCompletedAt?: string };
            }
        ) {
            return runTransaction(actor, id, async query => {
                const row = await rowFor(query, actor, id, true);
                if (row.status !== "reserved" || !row.exploration_dispatched || row.snapshot_hash)
                    throw new WeeklyReviewConflict("review_not_reserved");
                const trace =
                    values.trace === undefined
                        ? null
                        : JSON.stringify(minimizeExplorationTrace(values.trace));
                if (trace !== null && Buffer.byteLength(trace) > 510000)
                    throw new WeeklyReviewConflict("topic_exploration_failed:trace_limit");
                await query(
                    `
                    UPDATE pdr_ai_v2_vantage_weekly_review_run_manifests
                    SET trace=COALESCE(trace,'{}'::jsonb)||COALESCE($2::jsonb,'{}'::jsonb)||
                        jsonb_build_object('stages',COALESCE(trace->'stages','{}'::jsonb)||COALESCE($4::jsonb,'{}'::jsonb)),
                        digest_ids=COALESCE($3::jsonb,digest_ids)
                    WHERE run_id=$1::uuid
                `,
                    [
                        id,
                        trace,
                        values.digestIds ? JSON.stringify(values.digestIds) : null,
                        values.timing ? JSON.stringify(values.timing) : null,
                    ]
                );
            });
        },
        async topicCarryover(
            query: WeeklyReviewQuery,
            actor: WeeklyReviewActor,
            week: string
        ): Promise<TopicManifest["carryover"]> {
            const [row] = await query(
                `
                SELECT r.* FROM pdr_ai_v2_vantage_weekly_review_active a
                JOIN pdr_ai_v2_vantage_weekly_review_runs r ON r.id=a.run_id
                    AND r.company_id=a.company_id AND r.owner_id=a.owner_id
                WHERE a.company_id=$1::bigint AND a.owner_id=$2 AND a.week_start=$3::date-7 AND r.status='accepted'
            `,
                [actor.companyId, actor.userId, week]
            );
            if (!row) return "unavailable";
            try {
                await authority(query, actor, dependenciesOf(row), "read");
                const priorRunId = String(row.id);
                const stored = parseStoredReport(
                    decryptSecret(
                        String(row.ciphertext),
                        "vantage-report:" + actor.companyId + ":" + actor.userId + ":" + priorRunId
                    )
                );
                if (
                    stored.companyId !== actor.companyId ||
                    stored.ownerId !== actor.userId ||
                    stored.id !== priorRunId
                )
                    return "unavailable";
                const decisions = await query(
                    "SELECT ciphertext FROM pdr_ai_v2_vantage_weekly_review_decisions WHERE company_id=$1::bigint AND run_id=$2::uuid AND actor_id=$3",
                    [actor.companyId, priorRunId, actor.userId]
                );
                const decided = new Set(
                    decisions.map(
                        item => parseStoredDecision(decryptSecret(String(item.ciphertext))).topicId
                    )
                );
                const parsed = WeeklyReviewV21SchemaForCarryover.safeParse(stored.report);
                if (!parsed.success) return "unavailable";
                const refs = new Set(
                    parsed.data.topics
                        .filter(topic => !decided.has(topic.id))
                        .flatMap(topic => [
                            ...topic.facts,
                            ...topic.conflicts,
                            ...(topic.recommendation ? [topic.recommendation] : []),
                        ])
                        .flatMap(fact => fact.refs)
                );
                const ids = dependenciesOf(row)
                    .filter(
                        dep =>
                            refs.has("doc:" + dep.id + "@" + dep.version) ||
                            dep.scope?.dependency.units.some(unit => refs.has(unit.ref))
                    )
                    .map(dep => dep.id);
                return {
                    priorRunId,
                    reviewVersion: Number(row.review_version),
                    seedIds: [...new Set(ids)],
                };
            } catch (error) {
                if (
                    error instanceof WeeklyReviewConflict &&
                    error.code === "retrieval_acquisition_timeout"
                )
                    throw error;
                return "unavailable";
            }
        },
        expireUncertain(actor: WeeklyReviewActor, id: string) {
            return runTransaction(actor, id, async query => {
                const row = await rowFor(query, actor, id, true);
                await authority(query, actor, [], "recovery");
                if (row.status !== "reserved")
                    return { id, status: String(row.status), expired: false };
                const changed = await query(
                    "UPDATE pdr_ai_v2_vantage_weekly_review_runs SET status='failed',failure_code='dispatch_uncertain_expired',failure_record=$3::jsonb,ciphertext=NULL,key_version=NULL WHERE id=$1::uuid AND status='reserved' AND retrieval_mode='topic_first' AND coalesce(last_dispatch_at,created_at)<=now()-($2::int*interval '1 second') RETURNING id",
                    [
                        id,
                        TOPIC_FIRST_LIMITS.expirySeconds,
                        JSON.stringify(weeklyReviewFailureRecord("dispatch_uncertain_expired")),
                    ]
                );
                if (!changed.length)
                    throw new WeeklyReviewConflict("review_reservation_not_expired");
                const accounting = await attemptAccounting(query, actor, id);
                const failure = weeklyReviewFailureRecord("dispatch_uncertain_expired", {
                    counts: {
                        providerAttempts: safeReviewCount(accounting.totals?.attempts),
                        providerFailures: safeReviewCount(accounting.totals?.failures),
                    },
                    provider: accounting.provider,
                });
                await query(
                    "UPDATE pdr_ai_v2_vantage_weekly_review_runs SET failure_record=$2::jsonb WHERE id=$1::uuid AND status='failed'",
                    [id, JSON.stringify(failure)]
                );
                await clearTerminalTrace(query, id);
                return { id, status: "failed", expired: true };
            });
        },
        restore(
            actor: WeeklyReviewActor,
            id: string,
            input: { expectedActiveId: string | null; key: string }
        ) {
            return runTransaction(actor, id, async query => {
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
            dependencies: FrozenDependency[],
            candidateId?: string
        ) {
            return reservationTransaction(actor, key, async query => {
                await authority(query, actor, dependencies, "prepare");
                const rows = await query(
                    "INSERT INTO pdr_ai_v2_vantage_weekly_review_runs(id,company_id,owner_id,week_start,idempotency_key,input_hash,status,dependencies) VALUES($1::uuid,$2::bigint,$3,$4::date,$5,$6,'reserved',$7::jsonb) ON CONFLICT(company_id,owner_id,idempotency_key) DO NOTHING RETURNING *",
                    [
                        candidateId ?? randomUUID(),
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
            kind: "generation" | "judge" = "generation",
            expectedActiveId?: string | null,
            snapshotHash?: string
        ) {
            return runTransaction(actor, id, async query => {
                const row = await rowFor(query, actor, id, true);
                if (row.status !== "reserved")
                    throw new WeeklyReviewConflict("review_not_reserved");
                if (
                    row.retrieval_mode === "topic_first" &&
                    (!row.snapshot_hash || row.snapshot_hash !== snapshotHash)
                )
                    throw new WeeklyReviewConflict("candidate_admission_invalid");
                await authority(query, actor, dependenciesOf(row), "dispatch");
                if (row[kind + "_dispatched"] || (kind === "judge" && !row.generation_dispatched))
                    throw new WeeklyReviewConflict("dispatch_already_reserved_or_invalid_order");
                // Compare the week-owned pointer, without reading the old report's
                // frozen sources. A revoked old report must remain replaceable.
                // Final activation still performs CAS for races after this check.
                if (kind === "generation" && expectedActiveId !== undefined) {
                    const active = await query(
                        "SELECT run_id FROM pdr_ai_v2_vantage_weekly_review_active WHERE company_id=$1::bigint AND owner_id=$2 AND week_start=$3::date",
                        [actor.companyId, actor.userId, row.week_start]
                    );
                    if ((active[0]?.run_id ?? null) !== expectedActiveId)
                        throw new WeeklyReviewConflict("active_review_changed");
                }
                await query(
                    "UPDATE pdr_ai_v2_vantage_weekly_review_runs SET " +
                        kind +
                        "_dispatched=true WHERE id=$1::uuid",
                    [id]
                );
                if (row.retrieval_mode === "topic_first")
                    await query(
                        "UPDATE pdr_ai_v2_vantage_weekly_review_runs SET last_dispatch_at=clock_timestamp() WHERE id=$1::uuid",
                        [id]
                    );
            });
        },
        revalidateDispatch(
            actor: WeeklyReviewActor,
            id: string,
            kind: "generation" | "judge",
            expectedActiveId?: string | null,
            snapshotHash?: string
        ) {
            return runTransaction(actor, id, async query => {
                const row = await rowFor(query, actor, id, true);
                await checkedRetryDispatch(
                    query,
                    actor,
                    id,
                    row,
                    kind,
                    expectedActiveId,
                    snapshotHash
                );
            });
        },
        beginProviderAttempt(
            actor: WeeklyReviewActor,
            id: string,
            input: WeeklyReviewProviderAttemptInput
        ): Promise<string> {
            const attemptId = randomUUID();
            return runTransaction(actor, id, async query => {
                if (
                    !(PROVIDER_ATTEMPT_STAGES as readonly string[]).includes(input.stage) ||
                    !Number.isSafeInteger(input.attempt) ||
                    input.attempt < 1 ||
                    input.attempt > 2147483647 ||
                    (input.messageBytes !== null &&
                        (safeReviewCount(input.messageBytes) === null ||
                            input.messageBytes > 2147483647))
                )
                    throw new WeeklyReviewConflict("invalid_provider_attempt", 400);
                const deadline =
                    typeof input.deadlineAt === "string"
                        ? Date.parse(input.deadlineAt)
                        : input.deadlineAt;
                if (
                    deadline !== undefined &&
                    (!Number.isFinite(deadline) || Date.now() >= deadline)
                )
                    throw new WeeklyReviewConflict("provider_attempt_timeout", 503);
                const row = await rowFor(query, actor, id, true);
                if (row.status !== "reserved")
                    throw new WeeklyReviewConflict("review_not_reserved");
                if (input.stage === "generation" || input.stage === "judge") {
                    await checkedRetryDispatch(
                        query,
                        actor,
                        id,
                        row,
                        input.stage,
                        input.expectedActiveId,
                        input.snapshotHash
                    );
                } else {
                    if (
                        row.retrieval_mode !== "topic_first" ||
                        row.snapshot_hash ||
                        row.generation_dispatched ||
                        (input.stage === "digest"
                            ? row.exploration_dispatched
                            : !row.exploration_dispatched)
                    )
                        throw new WeeklyReviewConflict(
                            "dispatch_already_reserved_or_invalid_order"
                        );
                    if (
                        input.stage === "exploration" &&
                        Date.now() >= Date.parse(scalarText(row.exploration_deadline_at))
                    )
                        throw new WeeklyReviewConflict("topic_exploration_failed:timeout");
                    await topicAuthority(query, actor, row);
                    const { manifest } = await checkedManifest(query, id, row);
                    await authority(query, actor, manifest.fixedDependencies, "dispatch");
                }
                if (deadline !== undefined && Date.now() >= deadline)
                    throw new WeeklyReviewConflict("provider_attempt_timeout", 503);
                await query(
                    "INSERT INTO pdr_ai_v2_vantage_weekly_review_provider_attempts(id,run_id,company_id,owner_id,stage,attempt_ordinal,message_bytes) VALUES($1::uuid,$2::uuid,$3::bigint,$4,$5,$6,$7)",
                    [
                        attemptId,
                        id,
                        actor.companyId,
                        actor.userId,
                        input.stage,
                        input.attempt,
                        input.messageBytes,
                    ]
                );
                await query(
                    "UPDATE pdr_ai_v2_vantage_weekly_review_runs SET last_dispatch_at=clock_timestamp() WHERE id=$1::uuid",
                    [id]
                );
                return attemptId;
            });
        },
        /** Settlement cannot send content or resurrect a run. A revoked actor may
         * settle an already-journaled attempt using only owner scope and safe metering. */
        completeProviderAttempt(
            actor: WeeklyReviewActor,
            id: string,
            attemptId: string,
            outcome: unknown,
            usageIdentity?: ChatProviderAttemptUsageIdentity
        ): Promise<void> {
            return runTransaction(actor, id, async query => {
                const row = await rowFor(query, actor, id, true);
                const attempt = requireRow(
                    await query(
                        "SELECT outcome,settled_at FROM pdr_ai_v2_vantage_weekly_review_provider_attempts WHERE id=$1::uuid AND run_id=$2::uuid AND company_id=$3::bigint AND owner_id=$4 FOR UPDATE",
                        [attemptId, id, actor.companyId, actor.userId]
                    )
                );
                const safe = safeWeeklyReviewProviderOutcome(outcome);
                if (attempt.settled_at != null) {
                    if (
                        hash(safeWeeklyReviewProviderOutcome(storedJson(attempt.outcome))) !==
                        hash(safe)
                    )
                        throw new WeeklyReviewConflict("provider_attempt_already_settled");
                    return;
                }
                await query(
                    "UPDATE pdr_ai_v2_vantage_weekly_review_provider_attempts SET outcome=$2::jsonb,settled_at=clock_timestamp() WHERE id=$1::uuid AND settled_at IS NULL",
                    [attemptId, JSON.stringify(safe)]
                );
                if (usageIdentity)
                    await recordWeeklyReviewAttemptUsage(query, actor, safe.usage, usageIdentity);
                if (row.status === "failed") {
                    const previous = failureOf(row)!;
                    const accounting = await attemptAccounting(query, actor, id);
                    const failure = weeklyReviewFailureRecord(previous.code, {
                        ...previous,
                        provider: accounting.provider,
                        counts: {
                            ...previous.counts,
                            providerAttempts: safeReviewCount(accounting.totals?.attempts),
                            providerFailures: safeReviewCount(accounting.totals?.failures),
                        },
                    });
                    await query(
                        "UPDATE pdr_ai_v2_vantage_weekly_review_runs SET failure_record=$2::jsonb WHERE id=$1::uuid AND status='failed'",
                        [id, JSON.stringify(failure)]
                    );
                }
            });
        },
        fail(
            actor: WeeklyReviewActor,
            id: string,
            code: string,
            diagnostic?: WeeklyReviewFailureInput
        ) {
            return runTransaction(actor, id, async query => {
                const row = await rowFor(query, actor, id, true);
                if (row.status !== "reserved") return;
                const accounting = await attemptAccounting(query, actor, id);
                const failure = weeklyReviewFailureRecord(code, {
                    ...diagnostic,
                    stage: diagnostic?.stage ?? accounting.stage,
                    provider: accounting.provider,
                    counts: {
                        ...diagnostic?.counts,
                        messageBytes: diagnostic?.counts?.messageBytes ?? accounting.messageBytes,
                        providerAttempts: safeReviewCount(accounting.totals?.attempts),
                        providerFailures: safeReviewCount(accounting.totals?.failures),
                    },
                });
                await query(
                    "UPDATE pdr_ai_v2_vantage_weekly_review_runs SET status='failed',failure_code=$4,failure_record=$5::jsonb,ciphertext=NULL,key_version=NULL WHERE id=$1::uuid AND company_id=$2::bigint AND owner_id=$3 AND status='reserved'",
                    [id, actor.companyId, actor.userId, failure.code, JSON.stringify(failure)]
                );
                await clearTerminalTrace(query, id);
            });
        },
        accept(
            actor: WeeklyReviewActor,
            id: string,
            input: { report: unknown; evidence: unknown; expectedActiveId: string | null }
        ) {
            return runTransaction(actor, id, async query => {
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
                    evaluationInputBytes?: number;
                    judgeInputBytes?: number;
                    inputSnapshot?: WeeklyReviewInput;
                    selectionDiagnostics?: Record<string, unknown>;
                    scopedEvidence?: WeeklyReviewInput["scopedEvidence"];
                    sourceRegistry?: unknown;
                    freezeHash?: string;
                    budget?: ReturnType<typeof calculateWeeklyReviewBudget>;
                    evaluation?: {
                        status?: string;
                        verdict?: string;
                        error?: unknown;
                        integrityIssues?: { severity?: string }[];
                        scopedEvidence?: WeeklyReviewInput["scopedEvidence"];
                        version?: string;
                        rubricVersion?: string;
                        scenarioId?: string;
                        scenarioVersion?: string;
                        scenarioFingerprint?: string;
                        inputFingerprint?: string;
                        candidateId?: string;
                        pipelineVersion?: string;
                        contextCompleteness?: string;
                    };
                } | null;
                if (
                    !evidence ||
                    ![
                        "vantage-admission/v1",
                        "vantage-admission/v2",
                        "vantage-admission/v3",
                    ].includes(evidence.schemaVersion ?? "") ||
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
                const topicRun = row.retrieval_mode === "topic_first";
                if (topicRun) {
                    const { manifest, record } = await checkedManifest(query, id, row);
                    const snapshot = evidence.inputSnapshot;
                    const frozen = dependenciesOf(row);
                    const commitment = record.snapshot_commitment as {
                        snapshotHash?: string;
                        dependencyHash?: string;
                    } | null;
                    const context = snapshot?.retrievalContext;
                    if (
                        !snapshot ||
                        context?.schemaVersion !== "vantage-topic-retrieval/v1" ||
                        evidence.schemaVersion === "vantage-admission/v1" ||
                        snapshot.week !== manifest.week ||
                        snapshot.asOf !== manifest.asOf ||
                        snapshot.candidateId !== id ||
                        manifest.expectedActiveId !== input.expectedActiveId ||
                        fingerprint(snapshot) !== row.snapshot_hash ||
                        commitment?.snapshotHash !== row.snapshot_hash ||
                        commitment?.dependencyHash !== fingerprint(frozen) ||
                        fingerprint(frozen.slice(0, manifest.fixedDependencies.length)) !==
                            fingerprint(manifest.fixedDependencies)
                    )
                        throw new WeeklyReviewConflict("candidate_admission_invalid");
                    const { traceHash, ...contextFields } = context;
                    if (
                        traceHash !==
                        fingerprint([
                            record.manifest_hash,
                            { ...snapshot, retrievalContext: contextFields },
                        ])
                    )
                        throw new WeeklyReviewConflict("candidate_admission_invalid");
                    const fixed = new Map(manifest.fixed.map(source => [source.ref, source]));
                    const retrieved = frozen.slice(manifest.fixedDependencies.length);
                    if (
                        retrieved.some(
                            dep => !manifest.offered.some(offer => matchesOffer(offer, dep))
                        ) ||
                        snapshot.sources.length !==
                            fixed.size +
                                retrieved.reduce(
                                    (count, dep) =>
                                        count + (dep.scope?.dependency.units.length ?? 0),
                                    0
                                ) ||
                        new Set(snapshot.sources.map(source => source.ref)).size !==
                            snapshot.sources.length ||
                        [...fixed.keys()].some(
                            ref => !snapshot.sources.some(source => source.ref === ref)
                        )
                    )
                        throw new WeeklyReviewConflict("candidate_admission_invalid");
                    for (const source of snapshot.sources) {
                        const known = fixed.get(source.ref);
                        const parent = retrieved.find(dep =>
                            dep.scope?.dependency.units.some(unit => unit.ref === source.ref)
                        );
                        const unit = parent?.scope?.dependency.units.find(
                            unit => unit.ref === source.ref
                        );
                        const placed =
                            known ??
                            (parent && unit
                                ? {
                                      id: parent.id,
                                      version: parent.version,
                                      hash: unit.excerptHash,
                                      purpose: parent.purpose,
                                      audience: parent.scope?.dependency.audience,
                                  }
                                : undefined);
                        if (
                            !placed ||
                            placed.version !== source.version ||
                            placed.purpose !== source.purpose ||
                            placed.hash !== source.hash ||
                            (source as { audience?: string }).audience !== placed.audience ||
                            createHash("sha256").update(source.text).digest("hex") !== source.hash
                        )
                            throw new WeeklyReviewConflict("candidate_admission_invalid");
                    }
                }
                if (
                    dependenciesOf(row).some(
                        dependency => dependency.kind === "scoped-document"
                    ) !==
                    (evidence.schemaVersion === "vantage-admission/v3")
                )
                    throw new WeeklyReviewConflict("candidate_admission_invalid");
                if (
                    evidence.schemaVersion === "vantage-admission/v2" ||
                    evidence.schemaVersion === "vantage-admission/v3"
                ) {
                    try {
                        if (
                            !evidence.inputSnapshot ||
                            evidence.inputSnapshot.candidateId !== id ||
                            hash(evidence.inputSnapshot) !== evidence.inputHash
                        )
                            throw new Error("invalid_input");
                        if (!topicRun && evidence.inputSnapshot.retrievalContext) {
                            const context = evidence.inputSnapshot.retrievalContext;
                            const trace = evidence.selectionDiagnostics?.dynamicRetrieval as
                                | Record<string, unknown>
                                | undefined;
                            if (
                                !trace ||
                                hash(trace) !== context.traceHash ||
                                trace.mode !== context.mode ||
                                hash(trace.selectedRefs) !==
                                    hash(evidence.inputSnapshot.sources.map(source => source.ref))
                            )
                                throw new Error("invalid_retrieval_trace");
                        }
                        const budget = calculateWeeklyReviewBudget(
                            evidence.inputSnapshot,
                            topicRun
                                ? "topic-first"
                                : evidence.schemaVersion === "vantage-admission/v3"
                                  ? "scoped-v2"
                                  : "internal-v1"
                        );
                        if (!budget.feasible || hash(budget) !== hash(evidence.budget))
                            throw new Error("invalid_budget");
                        if (evidence.schemaVersion === "vantage-admission/v3") {
                            const snapshot = evidence.inputSnapshot;
                            const reservedWeek =
                                row.week_start instanceof Date
                                    ? row.week_start.toISOString().slice(0, 10)
                                    : scalarText(row.week_start).slice(0, 10);
                            if (snapshot.week !== reservedWeek)
                                throw new Error("invalid_reserved_week");
                            validateScopedWeeklyReviewInput(snapshot);
                            if (
                                !snapshot.scopedEvidence?.length ||
                                fingerprint(evidence.scopedEvidence) !==
                                    fingerprint(snapshot.scopedEvidence) ||
                                fingerprint(evidence.evaluation.scopedEvidence) !==
                                    fingerprint(snapshot.scopedEvidence)
                            )
                                throw new Error("invalid_scope");
                            const frozen = dependenciesOf(row);
                            const scoped = frozen.filter(
                                dependency => dependency.kind === "scoped-document"
                            );
                            if (
                                fingerprint(
                                    scoped.map(dependency => dependency.scope?.dependency)
                                ) !== fingerprint(snapshot.scopedEvidence)
                            )
                                throw new Error("invalid_frozen_scope");
                            const mandatory = frozen.filter(
                                dependency =>
                                    dependency.purpose === "company-architecture" ||
                                    dependency.purpose === "workspace-required"
                            );
                            if (
                                snapshot.mandatoryCoverage.required !== mandatory.length ||
                                snapshot.mandatoryCoverage.included !== mandatory.length
                            )
                                throw new Error("invalid_mandatory_coverage");
                            for (const dependency of frozen.filter(
                                dependency => dependency.kind === "document"
                            ))
                                if (
                                    !snapshot.sources.some(
                                        source =>
                                            source.ref ===
                                            "doc:" + dependency.id + "@" + dependency.version
                                    )
                                )
                                    throw new Error("missing_frozen_source");
                            for (const source of snapshot.sources) {
                                if (source.ref.startsWith("unit:")) continue;
                                if (
                                    !frozen.some(
                                        dependency =>
                                            dependency.kind === "document" &&
                                            source.ref ===
                                                "doc:" + dependency.id + "@" + dependency.version &&
                                            dependency.version === source.version &&
                                            dependency.hash === source.hash &&
                                            createHash("sha256")
                                                .update(source.text, "utf8")
                                                .digest("hex") === source.hash &&
                                            dependency.purpose === source.purpose
                                    )
                                )
                                    throw new Error("invalid_frozen_source");
                            }
                            const evaluation = weeklyReviewEvaluation(
                                input.report as WeeklyReviewV21,
                                snapshot
                            );
                            const assessed = evidence.evaluation;
                            if (
                                assessed.version !== SCOPED_EVALUATION_VERSION ||
                                assessed.rubricVersion !== SCOPED_RUBRIC_VERSION ||
                                assessed.scenarioId !== evaluation.scenario.id ||
                                assessed.scenarioVersion !== evaluation.scenario.version ||
                                assessed.scenarioFingerprint !== fingerprint(evaluation.scenario) ||
                                assessed.inputFingerprint !== fingerprint(evaluation) ||
                                assessed.candidateId !== evaluation.actual.id ||
                                assessed.pipelineVersion !== evaluation.actual.pipelineVersion ||
                                assessed.contextCompleteness !==
                                    evaluation.scenario.contextCompleteness
                            )
                                throw new Error("invalid_assessment_identity");
                            const admissionBytes = weeklyReviewAdmissionBytes(
                                input.report as WeeklyReviewV21,
                                snapshot
                            );
                            if (
                                admissionBytes.evaluationInputBytes !==
                                    evidence.evaluationInputBytes ||
                                admissionBytes.judgeInputBytes !== evidence.judgeInputBytes ||
                                admissionBytes.judgeInputBytes > budget.limits.judgeInputBytes
                            )
                                throw new Error("invalid_judge_budget");
                            if (
                                hash(evaluation) !== evidence.evaluationHash ||
                                Buffer.byteLength(JSON.stringify(evaluation)) >
                                    budget.limits.judgeInputBytes ||
                                hash(snapshot.sources) !== evidence.freezeHash ||
                                hash(
                                    snapshot.sources.map(
                                        ({ ref, version, hash, purpose, title }) => ({
                                            ref,
                                            version,
                                            hash,
                                            purpose,
                                            title,
                                        })
                                    )
                                ) !== hash(evidence.sourceRegistry)
                            )
                                throw new Error("invalid_evaluation");
                        }
                    } catch {
                        throw new WeeklyReviewConflict("candidate_admission_invalid");
                    }
                }
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
                    evidence: reportReadEvidence(
                        payload.evidence,
                        row.retrieval_mode === "topic_first"
                    ),
                    version: Number(row.review_version),
                    decisions: decisions.map(item =>
                        parseStoredDecision(decryptSecret(String(item.ciphertext)))
                    ),
                };
            });
        },
        list(actor: WeeklyReviewActor) {
            return transact(async query => {
                const rows = await query(
                    "SELECT id,week_start,status,review_version,created_at,failure_code,failure_record FROM pdr_ai_v2_vantage_weekly_review_runs WHERE company_id=$1::bigint AND owner_id=$2 ORDER BY created_at DESC,id DESC LIMIT 52",
                    [actor.companyId, actor.userId]
                );
                return rows.map(runSummary);
            }, "READ ONLY");
        },
        status(actor: WeeklyReviewActor, id: string) {
            return transact(async query => {
                const row = await rowFor(query, actor, id);
                const attempts = await query(
                    "SELECT id,stage,attempt_ordinal,message_bytes,started_at,settled_at,outcome FROM pdr_ai_v2_vantage_weekly_review_provider_attempts WHERE company_id=$1::bigint AND owner_id=$2 AND run_id=$3::uuid ORDER BY started_at DESC,id DESC LIMIT 257",
                    [actor.companyId, actor.userId, id]
                );
                return {
                    ...runSummary(row),
                    providerAttempts: attempts.slice(0, 256).map(weeklyReviewProviderAttempt),
                    providerAttemptsTruncated: attempts.length > 256,
                };
            }, "READ ONLY");
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
            return runTransaction(actor, id, async query => {
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
