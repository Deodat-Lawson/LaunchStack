/** Label-free benchmark runner. This module never imports benchmark labels or a model resolver. */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { invokeStructuredAttempt, ResolvedChatModel } from "@launchstack/llm";
import {
    deterministicDigestProvider,
    type DocumentDigest,
} from "@launchstack/store/document-digests";
import {
    RATED_CRITERIA,
    fingerprint,
    type ValidationJudge,
} from "@launchstack/pipelines/vantage/weekly-review-validation";
import {
    runWeeklyReviewV21,
    reviewFingerprint,
    type WeeklyReviewInput,
    type WeeklyReviewV21,
} from "@launchstack/pipelines/vantage/weekly-review-v21";
import {
    createWeeklyReviewAuthority,
    type WeeklyReviewAuthorityActor,
} from "../src/server/vantage/weekly-review-authority";
import { createWeeklyReviewRepository } from "../src/server/vantage/weekly-review-repository";
import {
    createScriptedExplorationPort,
    type TopicExplorationResult,
} from "../src/server/vantage/weekly-review-topic-exploration";
import {
    prepareTopicSelection,
    prewarmTopicDigests,
    type TopicSelectionProviders,
} from "../src/server/vantage/weekly-review-topic-run";
import { fitTopicEvidence } from "../src/server/vantage/weekly-review-topic-freeze";
import {
    WeeklyReviewConflict,
    type WeeklyReviewDatabase,
} from "../src/server/vantage/weekly-review-types";

export const BenchmarkQuestionSchema = z
    .object({
        caseId: z.string().min(1).max(80),
        enterprise: z.string().min(1).max(200),
        workspaceId: z.string().regex(/^[1-9]\d*$/),
        question: z.string().min(1).max(2000),
    })
    .strict();
export type BenchmarkQuestion = z.infer<typeof BenchmarkQuestionSchema>;
export const BenchmarkGroupSchema = z
    .object({
        groupId: z.string().min(1).max(80),
        enterprise: z.string().min(1).max(200),
        workspaceId: z.string().regex(/^[1-9]\d*$/),
        topics: z
            .array(
                z
                    .object({
                        caseId: z.string().min(1).max(80),
                        question: z.string().min(1).max(2000),
                    })
                    .strict()
            )
            .refine(
                topics => topics.length === 3 || topics.length === 5,
                "A group must contain exactly three or five topics"
            )
            .refine(
                topics => new Set(topics.map(topic => topic.caseId)).size === topics.length,
                "Group case IDs must be unique"
            ),
    })
    .strict();
export type BenchmarkGroup = z.infer<typeof BenchmarkGroupSchema>;
export type BenchmarkRequest = BenchmarkQuestion | BenchmarkGroup;
export function benchmarkTopicAttribution(input: {
    arm: BenchmarkArm;
    selection: TopicExplorationResult | null;
    documents: readonly { ref: string; id: string; version: string }[];
    selected: readonly { documentId: string | null; versionId: string }[];
}) {
    const base = {
        level: "document-version" as const,
        provenance: "exploration_submission_filtered_to_frozen_survivors" as const,
    };
    if (!input.arm.startsWith("configured-live") || input.selection === null)
        return {
            ...base,
            observable: false,
            entries: [] as { documentId: string; versionId: string; topicIds: string[] }[],
        };
    const frozen = new Set(
        input.selected
            .filter(source => source.documentId !== null)
            .map(source => source.documentId + "@" + source.versionId)
    );
    const documents = new Map(input.documents.map(document => [document.ref, document]));
    const associations = new Map<
        string,
        { documentId: string; versionId: string; topicIds: string[] }
    >();
    for (const item of input.selection.selected) {
        const document = documents.get(item.ref);
        if (!document) continue;
        const key = document.id + "@" + document.version;
        if (!frozen.has(key)) continue;
        const prior = associations.get(key);
        associations.set(key, {
            documentId: document.id,
            versionId: document.version,
            topicIds: [...new Set([...(prior?.topicIds ?? []), ...item.topicIds])],
        });
    }
    return { ...base, observable: true, entries: [...associations.values()] };
}

export type BenchmarkArm =
    | "baseline"
    | "seeds"
    | "scripted"
    | "configured-live-dry-run"
    | "configured-live";
export function assertBenchmarkDatabaseUrl(value: string) {
    const url = new URL(value);
    if (
        url.hostname !== "127.0.0.1" ||
        url.port !== "55569" ||
        url.pathname !== "/vantage_rag_benchmark_20261121" ||
        url.search !== "" ||
        url.hash !== "" ||
        value.includes("?") ||
        value.includes("#") ||
        !["postgres:", "postgresql:"].includes(url.protocol)
    )
        throw new Error("benchmark_local_database_required");
}
export function benchmarkFailureCode(error: unknown): string {
    if (error instanceof WeeklyReviewConflict && /^[a-z][a-z0-9_:]{0,100}$/.test(error.code))
        return error.code;
    if (error instanceof z.ZodError) return "benchmark_schema_invalid";
    if (
        error instanceof Error &&
        [
            "provider_timeout",
            "context_budget_exceeded",
            "report_budget_exceeded",
            "judge_input_budget_exceeded",
            "judge_admission_failed",
            "benchmark_actor_invalid",
            "benchmark_actor_must_be_fresh",
            "benchmark_live_requires_guarded_providers",
            "benchmark_question_exceeds_existing_guidance_limit",
            "benchmark_local_database_required",
            "benchmark_projected_budget_exceeded",
            "benchmark_digest_warm_up_incomplete",
            "benchmark_digest_missing_after_warm_up",
            "benchmark_group_evidence_budget_exceeded",
        ].includes(error.message)
    )
        return error.message;
    return "benchmark_run_failed";
}
function injectedReportPorts(
    input: WeeklyReviewInput,
    count: { generation: number; judge: number }
) {
    const source = input.sources[0]!;
    const report: WeeklyReviewV21 = {
        schemaVersion: "vantage-weekly-review/v2.1",
        headline: "Review supplied evidence",
        brief: "Injected benchmark mechanics",
        summary: "Review authorized evidence.",
        keyFigures: [],
        topics: [
            {
                title: "Evidence review",
                facts: [
                    {
                        text: source.text
                            .trim()
                            .slice(0, 180)
                            .replace(/[\uD800-\uDBFF]$/, ""),
                        refs: [source.ref],
                    },
                ],
                conflicts: [],
                whyItMatters: "Review the supplied evidence.",
                whyNow: "This reporting period requires review.",
                decisionQuestion: "What further evidence is needed?",
                rationale: "Authorized sources were supplied.",
                recommendation: null,
                proposedNextStep: "Discuss the evidence.",
                unknowns: [],
                proposedOwner: null,
                proposedDue: null,
                helpRequested: null,
            },
        ],
    };
    const validationJudge: ValidationJudge = {
        kind: "fixture-replay",
        id: "benchmark-injected-judge",
        async evaluate(request) {
            count.judge++;
            const unit = request.outputUnits[0]!;
            const evidence = [
                { kind: "source" as const, id: source.ref, quote: source.text.slice(0, 30) },
                { kind: "output" as const, id: unit.id, quote: unit.text.slice(0, 30) },
            ];
            return {
                judgment: {
                    expectations: request.input.scenario.expectations.map(item => ({
                        expectationId: item.id,
                        verdict: "met",
                        reason: "Injected mechanics only",
                        evidence: [
                            {
                                kind: "source",
                                id: item.evidence[0]!.sourceId,
                                quote: item.evidence[0]!.quote,
                            },
                            evidence[1],
                        ],
                    })),
                    ratings: RATED_CRITERIA.map(criterion => ({
                        criterion,
                        score: 4,
                        reason: "Injected mechanics only",
                        evidence,
                    })),
                },
            };
        },
    };
    return {
        generation: { modelId: "benchmark-injected-generation" } as ResolvedChatModel,
        judge: { modelId: "benchmark-injected-judge" } as ResolvedChatModel,
        validationJudge,
        invoke: (async () => {
            count.generation++;
            return { result: report, usage: {} };
        }) as typeof invokeStructuredAttempt,
    };
}
export async function runBenchmarkRetrieval(options: {
    request: BenchmarkRequest;
    arm: BenchmarkArm;
    databaseUrl: string;
    database: WeeklyReviewDatabase;
    loadActor: () => Promise<WeeklyReviewAuthorityActor>;
    week: string;
    asOf: string;
    endToEnd?: boolean;
    providers?: TopicSelectionProviders;
}) {
    assertBenchmarkDatabaseUrl(options.databaseUrl);
    const request = z.union([BenchmarkQuestionSchema, BenchmarkGroupSchema]).parse(options.request);
    const grouped = "topics" in request;
    const caseId = grouped ? request.groupId : request.caseId;
    const requestedTopics = (
        grouped ? request.topics : [{ caseId: request.caseId, question: request.question }]
    ).map(topic => ({ ...topic, topicId: randomUUID() }));
    const groupMetadata = grouped
        ? {
              topics: requestedTopics.map(({ caseId, topicId }) => ({ caseId, topicId })),
              retrievalLimits: { sharedEvidenceBytes: 80000, sourceUnits: 16 },
          }
        : {};
    if (options.arm === "configured-live" && !options.providers)
        throw new Error("benchmark_live_requires_guarded_providers");
    const actor = await options.loadActor();
    if (actor.companyId !== request.workspaceId || !actor.canRead || !actor.canMutate)
        throw new Error("benchmark_actor_invalid");
    const authority = createWeeklyReviewAuthority(options.database, options.loadActor, {
        internalRetrievalV1: true,
        scopedEvidenceV2: true,
        dynamicRetrieval: { mode: "baseline", maxFollowUpRounds: 0 },
    });
    const repository = createWeeklyReviewRepository(
        options.database,
        (query, current, dependencies, phase) =>
            authority.assertCurrentWeeklyReviewAuthority(query, current, dependencies, phase)
    );
    const id = randomUUID(),
        key = randomUUID();
    const accounting = {
        paidModelCalls: 0,
        embeddingCalls: 0,
        digestProviderCalls: 0,
        digestCacheHits: 0,
        explorationResponses: 0,
        explorationToolCalls: 0,
        generation: 0,
        judge: 0,
        estimatedExplorationInputTokens: 0,
        estimatedExplorationOutputTokens: 0,
        estimatedDigestInputTokens: 0,
        estimatedDigestOutputTokens: 0,
    };
    const started = performance.now();
    type Stage = "setup" | "collect" | "reserve" | "digest" | "exploration" | "freeze" | "finalize";
    const stageMs: Partial<Record<Stage, number>> = {};
    let activeStage: Stage = "setup";
    let stageStart = started;
    const nextStage = (next: Stage) => {
        const now = performance.now();
        stageMs[activeStage] = now - stageStart;
        activeStage = next;
        stageStart = now;
    };
    let offeredBeforeFailure: { documentId: string; versionId: string; ref: string }[] | undefined;
    const isTopic = options.arm !== "baseline";
    if (requestedTopics.some(topic => topic.question.length > 400))
        throw new Error("benchmark_question_exceeds_existing_guidance_limit");
    await options.database.transaction(async query => {
        const [existing] = await query(
            "SELECT id FROM pdr_ai_v2_vantage_personal_topics WHERE company_id=$1::bigint AND owner_id=$2 LIMIT 1",
            [actor.companyId, actor.userId]
        );
        if (existing) throw new Error("benchmark_actor_must_be_fresh");
        for (const [index, topic] of requestedTopics.entries())
            await query(
                grouped
                    ? "INSERT INTO pdr_ai_v2_vantage_personal_topics(id,company_id,owner_id,title,guidance,status,revision,created_at,updated_at) VALUES ($1::uuid,$2::bigint,$3,$4,$5::jsonb,'active',1,now()-($6::int*interval '1 millisecond'),now()-($6::int*interval '1 millisecond'))"
                    : "INSERT INTO pdr_ai_v2_vantage_personal_topics(id,company_id,owner_id,title,guidance,status,revision) VALUES ($1::uuid,$2::bigint,$3,$4,$5::jsonb,'active',1)",
                [
                    topic.topicId,
                    actor.companyId,
                    actor.userId,
                    "Benchmark question",
                    JSON.stringify({
                        openQuestions: [topic.question],
                        decisionChangers: [],
                        keywords: [],
                        people: [],
                        metrics: [],
                    }),
                    ...(grouped ? [requestedTopics.length - index] : []),
                ]
            );
    });
    let reserved = false;
    let submitted: TopicExplorationResult | null = null;
    let attributionDocuments: { ref: string; id: string; version: string }[] = [];
    try {
        nextStage("collect");
        const context = await authority.collectWeeklyReviewContext(
            actor,
            options.week,
            { candidateId: id, asOf: options.asOf },
            isTopic
                ? {
                      provider:
                          options.arm === "seeds"
                              ? "seeds"
                              : options.arm.startsWith("configured-live")
                                ? "configured"
                                : "scripted",
                      expectedActiveId: null,
                      carryover: async () => "unavailable",
                  }
                : undefined
        );
        const current = { ...actor, authorityEpoch: context.authorityEpoch };
        const seed = context.topicSeed;
        offeredBeforeFailure = seed?.manifest.offered.map(source => ({
            documentId: source.id,
            versionId: source.version,
            ref: source.ref,
        }));
        nextStage("reserve");
        let snapshot: WeeklyReviewInput = {
            candidateId: id,
            week: options.week,
            asOf: context.inputIdentity?.asOf ?? options.asOf,
            role: context.role,
            mandatoryCoverage: context.mandatoryCoverage,
            sources: context.sources,
            ...(context.scopedEvidence?.length ? { scopedEvidence: context.scopedEvidence } : {}),
        };
        if (seed) await repository.reserveTopic(current, key, id, seed.manifest);
        else
            await repository.reserve(
                current,
                options.week,
                key,
                reviewFingerprint(snapshot),
                context.dependencies ?? context.sources,
                id
            );
        reserved = true;
        if (seed) {
            const defaults: TopicSelectionProviders = {
                digest: deterministicDigestProvider,
                exploration: createScriptedExplorationPort,
            };
            const baseProviders = options.providers ?? defaults;
            const providers: TopicSelectionProviders = {
                digest: async input => {
                    accounting.digestProviderCalls++;
                    if (options.arm === "configured-live") accounting.paidModelCalls++;
                    accounting.estimatedDigestInputTokens += Math.ceil(
                        JSON.stringify({ title: input.title, text: input.text }).length / 4
                    );
                    const result = await baseProviders.digest(input);
                    accounting.estimatedDigestOutputTokens += Math.ceil(
                        JSON.stringify(result).length / 4
                    );
                    return result;
                },
                exploration: documents => {
                    const port = baseProviders.exploration(documents);
                    return {
                        async respond(input) {
                            accounting.explorationResponses++;
                            if (options.arm === "configured-live") accounting.paidModelCalls++;
                            accounting.estimatedExplorationInputTokens += Math.ceil(
                                (input.system.length +
                                    JSON.stringify(input.transcript).length +
                                    JSON.stringify(input.tools).length) /
                                    4
                            );
                            const result = await port.respond(input);
                            accounting.explorationToolCalls += result.toolCalls.length;
                            accounting.estimatedExplorationOutputTokens += Math.ceil(
                                JSON.stringify(result).length / 4
                            );
                            return result;
                        },
                    };
                },
            };
            const query = (sql: string, args?: unknown[]) =>
                options.database.transaction(query => query(sql, args));
            let digests: ReadonlyMap<string, DocumentDigest> = new Map();
            const usesExploration = seed.manifest.configuration.provider !== "seeds";
            if (usesExploration) {
                await repository.beginDigestPreparation(current, id);
                nextStage("digest");
                const digestStart = Date.now();
                try {
                    const prepared = await prewarmTopicDigests({
                        actor: await options.loadActor(),
                        versionIds: seed.documents.map(document => document.version),
                        query,
                        provider: providers.digest,
                        cachePolicy: options.arm === "configured-live" ? "shared" : "ephemeral",
                        authorizeDocument: async () => {
                            const [epoch] = await query(
                                "SELECT version FROM pdr_ai_v2_vantage_weekly_review_epochs WHERE company_id=$1::bigint",
                                [actor.companyId]
                            );
                            if (String(epoch?.version) !== seed.manifest.epoch)
                                throw new WeeklyReviewConflict("source_authority_changed");
                            return true;
                        },
                    });
                    digests = prepared.digests;
                    accounting.digestCacheHits = Math.max(
                        0,
                        digests.size - accounting.digestProviderCalls
                    );
                    await repository.recordDigestPreparation(current, id, {
                        digestIds: prepared.digestIds,
                        timing: { ...prepared.timing, digestOutcome: "ready" },
                    });
                } catch (error) {
                    await repository.recordDigestPreparation(current, id, {
                        timing: {
                            digestCompletedAt: new Date().toISOString(),
                            digestDurationMs: Date.now() - digestStart,
                            digestOutcome: "failed",
                        },
                    });
                    throw error;
                }
            }
            const deadlineAt = await repository.claimExploration(current, id);
            let selection = null;
            if (usesExploration) {
                nextStage("exploration");
                await repository.recordExploration(current, id, {
                    timing: { explorationStartedAt: new Date().toISOString() },
                });
                try {
                    selection = await prepareTopicSelection({
                        seed,
                        actor: await options.loadActor(),
                        deadlineAt,
                        digests,
                        providers,
                        query,
                        record: values => repository.recordExploration(current, id, values),
                    });
                } finally {
                    await repository.recordExploration(current, id, {
                        timing: { explorationCompletedAt: new Date().toISOString() },
                    });
                }
            }
            submitted = selection;
            attributionDocuments = [...seed.documents, ...seed.manifest.fixed];
            nextStage("freeze");
            const frozen = await repository.freezeTopic(current, id, query =>
                authority.withTopicSourceReader(query, current, read =>
                    fitTopicEvidence(id, seed, selection, read)
                )
            );
            snapshot = frozen.input;
        }
        nextStage("finalize");
        if (
            grouped &&
            snapshot.sources.reduce(
                (sum, source) => sum + Buffer.byteLength(source.text, "utf8"),
                0
            ) > 80000
        )
            throw new Error("benchmark_group_evidence_budget_exceeded");
        let generation: unknown;
        if (options.endToEnd) {
            try {
                const result = await runWeeklyReviewV21(snapshot, {
                    ...injectedReportPorts(snapshot, accounting),
                    budgetProfile: seed
                        ? "topic-first"
                        : snapshot.scopedEvidence
                          ? "scoped-v2"
                          : "internal-v1",
                    authorizeDispatch: kind =>
                        repository.authorizeDispatch(
                            current,
                            id,
                            kind,
                            null,
                            seed ? fingerprint(snapshot) : undefined
                        ),
                });
                await repository.accept(current, id, { ...result, expectedActiveId: null });
                const saved = await repository.get(current, id);
                generation = { status: "accepted", report: saved.report, evidence: saved.evidence };
            } catch (error) {
                await repository.fail(current, id, "benchmark_injected_end_to_end_failed");
                generation = {
                    status: "failed",
                    failure: benchmarkFailureCode(error),
                };
            }
        } else await repository.fail(current, id, "benchmark_retrieval_only_complete");
        const selected = snapshot.sources.map(source => {
            const proof = snapshot.scopedEvidence?.find(parent =>
                parent.units.some(unit => unit.ref === source.ref)
            );
            const unit = proof?.units.find(unit => unit.ref === source.ref);
            const document = /^doc:(\d+)@/.exec(source.ref);
            return {
                documentId: proof?.documentId ?? document?.[1] ?? null,
                versionId: source.version,
                ref: source.ref,
                text: source.text,
                start: unit?.start ?? 0,
                end: unit?.end ?? source.text.length,
                kind: unit ? "excerpt" : "full_document",
                purpose: source.purpose,
            };
        });
        stageMs[activeStage] = performance.now() - stageStart;
        const completed = {
            runId: reserved ? id : undefined,
            stageMs,
            caseId,
            ...groupMetadata,
            enterprise: request.enterprise,
            workspaceId: request.workspaceId,
            arm: options.arm,
            status: "ok",
            offeredDefinition: seed
                ? "ACL-filtered S0 offered set, fixed refs excluded"
                : "ACL-authorized successfully read baseline candidates: selected and budget/rank omissions; acquisition failures excluded",
            offered: offeredBeforeFailure ?? [
                ...(context.selectionDiagnostics?.selected ?? []).map(source => ({
                    documentId: source.id,
                    versionId: source.version,
                    ref: `doc:${source.id}@${source.version}`,
                })),
                ...(context.selectionDiagnostics?.omitted ?? [])
                    .filter(
                        source =>
                            source.version &&
                            ["budget_exceeded", "ranked_lower"].includes(source.reason)
                    )
                    .map(source => ({
                        documentId: source.id,
                        versionId: source.version!,
                        ref: `doc:${source.id}@${source.version}`,
                    })),
            ],
            selectionDiagnostics: context.selectionDiagnostics,
            selected,
            ...(grouped
                ? {
                      topicAttribution: benchmarkTopicAttribution({
                          arm: options.arm,
                          selection: submitted,
                          documents: attributionDocuments,
                          selected,
                      }),
                  }
                : {}),
            frozenBytes: snapshot.sources.reduce(
                (sum, source) => sum + Buffer.byteLength(source.text),
                0
            ),
            snapshot,
            generation,
            accounting,
            durationMs: performance.now() - started,
        };
        return completed as typeof completed & { failure?: string };
    } catch (error) {
        if (reserved) await repository.fail(actor, id, "benchmark_run_failed");
        stageMs[activeStage] = performance.now() - stageStart;
        return {
            runId: reserved ? id : undefined,
            stageMs,
            caseId,
            ...groupMetadata,
            enterprise: request.enterprise,
            workspaceId: request.workspaceId,
            arm: options.arm,
            status: "failed",
            offered: offeredBeforeFailure,
            failure: benchmarkFailureCode(error),
            accounting,
            durationMs: performance.now() - started,
        };
    }
}
