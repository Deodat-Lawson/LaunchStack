import { weekStartOf, parseIsoDate, toIsoDate } from "@launchstack/pipelines/vantage";
import type { WeeklyReviewStage } from "./weekly-review-client-types";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import pLimit from "p-limit";
import { createSlot } from "@launchstack/runtime/slot";
import {
    isChatRoute,
    type ChatProviderRetryPolicy,
    type ChatProviderAttemptOutcome,
    type ChatProviderAttemptUsageIdentity,
} from "@launchstack/llm";
import {
    runWeeklyReviewV21,
    weeklyReviewDiagnosticSnapshot,
    type WeeklyReviewInput,
} from "@launchstack/pipelines/vantage/weekly-review-v21";
import { getEngine } from "~/server/engine";
import { requireBetaAppContext } from "~/server/beta-apps";
import { recordAiUsage } from "~/server/ai-usage/record";
import { vantageV2Enabled } from "./v2/enabled";
import { resolveConfiguredChatModel } from "~/lib/models";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";
import {
    createWeeklyReviewAuthority,
    type TopicAuthorityCheckpoint,
    type WeeklyReviewAuthorityActor,
} from "./weekly-review-authority";
import { createWeeklyReviewRepository } from "./weekly-review-repository";
import {
    WeeklyReviewConflict,
    type WeeklyReviewDatabase,
    type WeeklyReviewActor,
    type WeeklyReviewQuery,
} from "./weekly-review-types";
import { fingerprint } from "@launchstack/pipelines/vantage/weekly-review-validation";
import { fitTopicEvidence } from "./weekly-review-topic-freeze";
import {
    prepareTopicSelection,
    prewarmTopicDigests,
    resolveTopicSelectionProviders,
    topicDigestConcurrency,
} from "./weekly-review-topic-run";
import {
    TOPIC_FIRST_LIMITS,
    topicFirstProvider,
    topicFirstEvidenceStrategy,
} from "./weekly-review-topic-types";
import { weeklyReviewTestPorts } from "./weekly-review-test-provider";
import {
    allowSharedJudgeDeployment,
    judgeDeploymentDiagnostics,
} from "./weekly-review-judge-policy";
import {
    safeWeeklyReviewFailureCode,
    weeklyReviewFailureRecord,
    type WeeklyReviewFailureStage,
    type WeeklyReviewProviderStage,
} from "./weekly-review-failure-record";

export function weeklyReviewEnabled() {
    return process.env.VANTAGE_WEEKLY_REVIEW_ENABLED === "true";
}
export const weeklyReviewDatabase: WeeklyReviewDatabase = {
    async transaction(work) {
        return getEngine().db.transaction(async tx => {
            const query: WeeklyReviewQuery = async (text, parameters = []) => {
                const parts = text
                    .split(/(\$\d+)/g)
                    .map(part =>
                        /^\$\d+$/.test(part)
                            ? sql.param(parameters[Number(part.slice(1)) - 1])
                            : sql.raw(part)
                    );
                return [...(await tx.execute(sql.join(parts, sql.raw(""))))] as Record<
                    string,
                    unknown
                >[];
            };
            query.executor = tx;
            query.recordAiUsage = (companyId, userId, event, options) =>
                recordAiUsage(companyId, "vantage", event, new Date(), userId, {
                    writer: tx,
                    ...options,
                });
            return work(query);
        });
    },
};
export async function loadWeeklyReviewActor(
    query?: WeeklyReviewQuery
): Promise<WeeklyReviewAuthorityActor> {
    if (query && !query.executor) throw new WeeklyReviewConflict("review_access_denied", 403);
    const result = await requireBetaAppContext(query?.executor);
    if (!result.success) throw new WeeklyReviewConflict("review_access_denied", 403);
    const ctx = result.data;
    return {
        companyId: String(ctx.companyId),
        userId: ctx.authUserId,
        role: ctx.role,
        canRead: ctx.can("documents.read"),
        canMutate: ctx.can("documents.edit"),
        canConfigure: ctx.can("settings.manage"),
        documentScope: await ctx.documentScope(),
    };
}
export function weeklyReviewServices() {
    const authority = createWeeklyReviewAuthority(weeklyReviewDatabase, loadWeeklyReviewActor, {
        internalRetrievalV1: true,
        scopedEvidenceV2: true,
    });
    return {
        authority,
        repository: createWeeklyReviewRepository(
            weeklyReviewDatabase,
            (query, actor, dependencies, phase) =>
                authority.assertCurrentWeeklyReviewAuthority(query, actor, dependencies, phase)
        ),
    };
}
const digestConnectionLimits = createSlot<WeakMap<object, ReturnType<typeof pLimit>>>(
    "vantage-weekly-review-digest-connection-limits"
);

function digestPoolSize(): number {
    return getEngine().dbHandle.client.options.max;
}

function runDigestTransaction<T>(work: () => Promise<T>): Promise<T> {
    const pool = getEngine().dbHandle.client;
    const limits = digestConnectionLimits.get() ?? new WeakMap<object, ReturnType<typeof pLimit>>();
    digestConnectionLimits.set(limits);
    let limit = limits.get(pool);
    if (!limit) {
        limit = pLimit(topicDigestConcurrency(pool.options.max));
        limits.set(pool, limit);
    }
    // A permit covers a short DB transaction. Provider waits hold no pool permit.
    return limit(work);
}

async function recordFailedStageTiming(write: () => Promise<unknown>) {
    try {
        await write();
    } catch {
        // Terminalization still needs the original stage error.
    }
}

/** Reject rather than normalize: stored idempotency and active pointers use exact dates. */
export function assertWeeklyReviewWeek(week: string) {
    const date = parseIsoDate(week);
    if (!date || toIsoDate(date) !== week || weekStartOf(date) !== week)
        throw new WeeklyReviewConflict("invalid_review_week", 400);
}
export async function generateWeeklyReview(
    actor: WeeklyReviewActor,
    args: { weekStart: string; key: string; expectedActiveId: string | null },
    onStage?: (stage: WeeklyReviewStage) => void
) {
    const runDeadlineAt =
        Date.now() +
        TOPIC_FIRST_LIMITS.digestMs +
        TOPIC_FIRST_LIMITS.explorationMs +
        TOPIC_FIRST_LIMITS.generationMs +
        TOPIC_FIRST_LIMITS.judgeMs;
    assertWeeklyReviewWeek(args.weekStart);
    const stage = (value: WeeklyReviewStage) => {
        try {
            onStage?.(value);
        } catch {
            /* An observer cannot change the run. */
        }
    };
    if (!weeklyReviewEnabled()) throw new WeeklyReviewConflict("weekly_review_disabled", 404);
    const { authority, repository } = weeklyReviewServices();
    const replay = (run: { id: string; status: string }) => {
        if (run.status === "accepted") return repository.get(actor, run.id);
        throw new WeeklyReviewConflict(
            run.status === "failed" ? "review_failed_use_new_key" : "review_dispatch_uncertain"
        );
    };
    const prior = await repository.findByKey(actor, args.weekStart, args.key);
    if (prior) return replay(prior);
    const topicProvider = topicFirstProvider();
    const v2 = vantageV2Enabled();
    const identity = { candidateId: randomUUID(), asOf: new Date().toISOString() };
    stage("gathering");
    const context = await authority.collectWeeklyReviewContext(actor, args.weekStart, identity, {
        provider: topicProvider,
        ...(v2 ? { v2 } : {}),
        expectedActiveId: args.expectedActiveId,
        carryover: query => repository.topicCarryover(query, actor, args.weekStart),
    });
    const seed = context.topicSeed;
    if (!seed) throw new WeeklyReviewConflict("topic_seed_required");
    seed.manifest.configuration = {
        ...seed.manifest.configuration,
        evidenceStrategy: topicFirstEvidenceStrategy(),
    };
    const current = { ...actor, authorityEpoch: context.authorityEpoch };
    let input: WeeklyReviewInput = {
        candidateId: context.inputIdentity?.candidateId ?? randomUUID(),
        week: args.weekStart,
        asOf: context.inputIdentity?.asOf ?? new Date().toISOString(),
        role: context.role,
        mandatoryCoverage: context.mandatoryCoverage,
        sources: context.sources,
        ...(context.scopedEvidence?.length ? { scopedEvidence: context.scopedEvidence } : {}),
        ...(context.retrievalContext ? { retrievalContext: context.retrievalContext } : {}),
    };
    const reserved = await repository.reserveTopic(
        current,
        args.key,
        input.candidateId,
        seed.manifest
    );
    if (!reserved.created) return replay(reserved);
    input.candidateId = reserved.id;
    let failureStage: WeeklyReviewFailureStage = "prepare";
    let terminal = false;
    let providerAttempts = 0,
        providerFailures = 0;
    let messageBytes: number | null = null;
    let lastOutcome: ChatProviderAttemptOutcome | undefined;
    const checkRun = () => {
        if (terminal || Date.now() >= runDeadlineAt)
            throw new WeeklyReviewConflict("review_deadline_exceeded", 503);
    };
    const stageDeadlines: Partial<Record<WeeklyReviewProviderStage, number>> = {};
    const withDigestTransaction = <T>(work: () => Promise<T>) =>
        runDigestTransaction(() => {
            checkRun();
            if (Date.now() >= (stageDeadlines.digest ?? runDeadlineAt))
                throw new WeeklyReviewConflict("topic_digest_failed:timeout");
            return work();
        });
    const authorizeStep = async (checkpoint: TopicAuthorityCheckpoint) => {
        checkRun();
        if (!weeklyReviewEnabled()) throw new WeeklyReviewConflict("weekly_review_disabled", 404);
        const authorize = () =>
            weeklyReviewDatabase.transaction(async query => {
                await query("SET LOCAL statement_timeout='5000ms'");
                await authority.assertTopicStep(query, current, seed.manifest, checkpoint);
            });
        if (checkpoint === "digest") await withDigestTransaction(authorize);
        else await authorize();
        checkRun();
    };
    const retryPolicies: Partial<Record<WeeklyReviewProviderStage, ChatProviderRetryPolicy>> = {};
    const retryPolicy = (
        kind: WeeklyReviewProviderStage,
        deadlineAt = runDeadlineAt
    ): ChatProviderRetryPolicy => {
        const policy: ChatProviderRetryPolicy = {
            usageAccounting: "settlement",
            deadlineAt: Math.min(runDeadlineAt, deadlineAt),
            async beforeAttempt(info) {
                checkRun();
                failureStage = kind;
                if (Date.now() >= policy.deadlineAt)
                    throw new WeeklyReviewConflict("review_deadline_exceeded", 503);
                if (!weeklyReviewEnabled())
                    throw new WeeklyReviewConflict("weekly_review_disabled", 404);
                if (kind === "digest" || kind === "exploration")
                    await authorizeStep(kind === "digest" ? "digest" : "provider");
                const attemptId = await repository.beginProviderAttempt(current, reserved.id, {
                    stage: kind,
                    attempt: info.attempt,
                    messageBytes: info.messageBytes,
                    deadlineAt: policy.deadlineAt,
                    ...(kind === "generation" || kind === "judge"
                        ? {
                              snapshotHash: fingerprint(input),
                              expectedActiveId: args.expectedActiveId,
                          }
                        : {}),
                });
                providerAttempts++;
                messageBytes = info.messageBytes;
                const settle = async (
                    outcome: ChatProviderAttemptOutcome,
                    usageIdentity?: ChatProviderAttemptUsageIdentity
                ) => {
                    lastOutcome = outcome;
                    if (outcome.statusClass !== "success") providerFailures++;
                    await repository.completeProviderAttempt(
                        current,
                        reserved.id,
                        attemptId,
                        outcome,
                        usageIdentity
                    );
                };
                try {
                    checkRun();
                    if (!weeklyReviewEnabled())
                        throw new WeeklyReviewConflict("weekly_review_disabled", 404);
                } catch (error) {
                    // The durable start exists, but this request is known not to have been sent.
                    await settle({
                        statusClass: Date.now() >= policy.deadlineAt ? "deadline" : "aborted",
                        httpStatus: null,
                    });
                    throw error;
                }
                return settle;
            },
        };
        retryPolicies[kind] = policy;
        return policy;
    };
    const budgetPorts = { budgetProfile: "topic-first" as const };
    const sharedJudgeAllowed = allowSharedJudgeDeployment();
    const authorizeDispatch = async (kind: "generation" | "judge") => {
        checkRun();
        failureStage = kind;
        stageDeadlines[kind] ??= Math.min(
            runDeadlineAt,
            Date.now() +
                (kind === "generation"
                    ? TOPIC_FIRST_LIMITS.generationMs
                    : TOPIC_FIRST_LIMITS.judgeMs)
        );
        if (retryPolicies[kind]) retryPolicies[kind].deadlineAt = stageDeadlines[kind]!;
        if (!weeklyReviewEnabled()) throw new WeeklyReviewConflict("weekly_review_disabled", 404);
        await repository.authorizeDispatch(
            current,
            reserved.id,
            kind,
            args.expectedActiveId,
            fingerprint(input)
        );
        if (kind === "generation") stage("writing");
    };
    const onGenerationComplete = () => stage("checking");
    let runTimer: ReturnType<typeof setTimeout> | undefined;
    try {
        const result = await Promise.race([
            withWorkspaceChatModels(
                BigInt(actor.companyId),
                { feature: "vantage", userId: actor.userId },
                async () => {
                    if (seed) {
                        // Apply the fixture guard before digest or exploration dispatch.
                        if (seed.manifest.configuration.provider !== "configured")
                            weeklyReviewTestPorts(input);
                        const query = (statement: string, parameters?: unknown[]) =>
                            weeklyReviewDatabase.transaction(async query => {
                                await query("SET LOCAL statement_timeout='5000ms'");
                                return query(statement, parameters);
                            });
                        const needsDigests = seed.manifest.configuration.provider !== "seeds";
                        checkRun();
                        failureStage = "digest";
                        stageDeadlines.digest = Math.min(
                            runDeadlineAt,
                            Date.now() + TOPIC_FIRST_LIMITS.digestMs
                        );
                        if (needsDigests)
                            await repository.beginDigestPreparation(current, reserved.id);
                        const digestStarted = Date.now();
                        let providers:
                            | Awaited<ReturnType<typeof resolveTopicSelectionProviders>>
                            | undefined;
                        let prepared: Awaited<ReturnType<typeof prewarmTopicDigests>> = {
                            digests: new Map(),
                            digestIds: [] as string[],
                            timing: {
                                digestStartedAt: new Date().toISOString(),
                                digestCompletedAt: new Date().toISOString(),
                                digestDurationMs: 0,
                            },
                        };
                        try {
                            if (needsDigests) {
                                providers = await resolveTopicSelectionProviders(seed, undefined, {
                                    digest: () => retryPolicy("digest", stageDeadlines.digest),
                                    exploration: deadlineAt =>
                                        retryPolicy(
                                            "exploration",
                                            Math.min(
                                                stageDeadlines.exploration!,
                                                deadlineAt ?? runDeadlineAt
                                            )
                                        ),
                                });
                                prepared = await prewarmTopicDigests({
                                    actor: await loadWeeklyReviewActor(),
                                    versionIds: seed.documents.map(document => document.version),
                                    query: (statement, parameters) =>
                                        withDigestTransaction(() => query(statement, parameters)),
                                    poolSize: digestPoolSize,
                                    provider: providers.digest,
                                    timeoutMs: Math.max(1, stageDeadlines.digest - Date.now()),
                                    authorizeDocument: async () => {
                                        await authorizeStep("digest");
                                        return true;
                                    },
                                });
                                await repository.recordDigestPreparation(current, reserved.id, {
                                    digestIds: prepared.digestIds,
                                    timing: { ...prepared.timing, digestOutcome: "ready" },
                                });
                            }
                        } catch (error) {
                            if (needsDigests)
                                await recordFailedStageTiming(() =>
                                    repository.recordDigestPreparation(current, reserved.id, {
                                        timing: {
                                            digestCompletedAt: new Date().toISOString(),
                                            digestDurationMs: Date.now() - digestStarted,
                                            digestOutcome: "failed",
                                        },
                                    })
                                );
                            throw error;
                        }
                        checkRun();
                        failureStage = "exploration";
                        const deadlineAt = Math.min(
                            runDeadlineAt,
                            await repository.claimExploration(current, reserved.id)
                        );
                        stageDeadlines.exploration = deadlineAt;
                        if (seed.manifest.configuration.provider !== "seeds") stage("exploring");
                        await repository.recordExploration(current, reserved.id, {
                            timing: { explorationStartedAt: new Date().toISOString() },
                        });
                        const recordExplorationCompletion = () =>
                            repository.recordExploration(current, reserved.id, {
                                timing: { explorationCompletedAt: new Date().toISOString() },
                            });
                        let selection;
                        try {
                            selection = await prepareTopicSelection({
                                seed,
                                actor: await loadWeeklyReviewActor(),
                                deadlineAt,
                                digests: prepared.digests,
                                providers,
                                query,
                                authorizeStep,
                                ...(v2 ? { lexicalFallback: true } : {}),
                                record: values =>
                                    repository.recordExploration(current, reserved.id, values),
                            });
                        } catch (error) {
                            await recordFailedStageTiming(recordExplorationCompletion);
                            throw error;
                        }
                        await recordExplorationCompletion();
                        checkRun();
                        const frozen = await repository.freezeTopic(current, reserved.id, query =>
                            authority.withTopicSourceReader(query, current, read =>
                                fitTopicEvidence(reserved.id, seed, selection, read)
                            )
                        );
                        input = frozen.input;
                    }
                    checkRun();
                    failureStage = "generation";
                    const test = weeklyReviewTestPorts(input);
                    if (test) {
                        await repository.recordJudgeDeployment(
                            current,
                            reserved.id,
                            judgeDeploymentDiagnostics(
                                test.generation.modelId,
                                test.judge.modelId,
                                sharedJudgeAllowed
                            )
                        );
                        return runWeeklyReviewV21(input, {
                            ...test,
                            ...budgetPorts,
                            authorizeDispatch,
                            onGenerationComplete,
                            allowSharedJudgeDeployment: sharedJudgeAllowed,
                        });
                    }
                    const generationRoute =
                        process.env.VANTAGE_WEEKLY_REVIEW_GENERATION_ROUTE ?? "default";
                    const judgeRoute = process.env.VANTAGE_WEEKLY_REVIEW_JUDGE_ROUTE ?? "reasoning";
                    if (!isChatRoute(generationRoute) || !isChatRoute(judgeRoute))
                        throw Error("review_model_unavailable");
                    const generation = resolveConfiguredChatModel({
                        route: generationRoute,
                        maxRetries: 0,
                        maxOutputTokens: 3600,
                        timeoutMs: TOPIC_FIRST_LIMITS.generationMs,
                        providerRetry: retryPolicy("generation"),
                    });
                    const judge = resolveConfiguredChatModel({
                        route: judgeRoute,
                        maxRetries: 0,
                        maxOutputTokens: 6000,
                        timeoutMs: TOPIC_FIRST_LIMITS.judgeMs,
                        providerRetry: retryPolicy("judge"),
                    });
                    if (
                        generation.behavior.parameters.maxOutputTokens !== "supported" ||
                        judge.behavior.parameters.maxOutputTokens !== "supported"
                    )
                        throw Error("review_model_unavailable");
                    await repository.recordJudgeDeployment(
                        current,
                        reserved.id,
                        judgeDeploymentDiagnostics(
                            generation.modelId,
                            judge.modelId,
                            sharedJudgeAllowed
                        )
                    );
                    return runWeeklyReviewV21(input, {
                        generation,
                        judge,
                        ...budgetPorts,
                        authorizeDispatch,
                        onGenerationComplete,
                        allowSharedJudgeDeployment: sharedJudgeAllowed,
                    });
                }
            ),
            new Promise<never>((_, reject) => {
                runTimer = setTimeout(
                    () => reject(new WeeklyReviewConflict("review_deadline_exceeded", 503)),
                    Math.max(0, runDeadlineAt - Date.now())
                );
            }),
        ]);
        checkRun();
        const report = {
            ...result.report,
            topics: result.report.topics.map((topic, index) => ({
                ...topic,
                id: "topic-" + index,
            })),
        };
        stage("saving");
        failureStage = "admission";
        await repository.accept(current, reserved.id, {
            report,
            evidence: {
                ...result.evidence,
                retrievalMode: "topic-first",
                qualityEvidence:
                    process.env.VANTAGE_WEEKLY_REVIEW_TEST_PROVIDER === "true"
                        ? "injected-deterministic"
                        : result.evidence.judgeIndependent
                          ? "independent-configured-models"
                          : "shared-judge-test",
            },
            expectedActiveId: args.expectedActiveId,
        });
        return repository.get(actor, reserved.id);
    } catch (error) {
        terminal = true;
        const snapshot = weeklyReviewDiagnosticSnapshot(error);
        const code = safeWeeklyReviewFailureCode(
            error instanceof WeeklyReviewConflict
                ? error.code
                : error instanceof Error
                  ? error.message
                  : undefined
        );
        const classified = weeklyReviewFailureRecord(code);
        const diagnostic = weeklyReviewFailureRecord(code, {
            stage: snapshot?.stage ?? failureStage,
            ...(snapshot
                ? {
                      statusClass: "validation",
                      validatorCodes: snapshot.stage === "judge" ? [] : snapshot.ruleCodes,
                      judgeCodes: snapshot.stage === "judge" ? snapshot.ruleCodes : [],
                  }
                : classified.statusClass === "unknown" &&
                    lastOutcome &&
                    lastOutcome.statusClass !== "success"
                  ? {
                        statusClass:
                            lastOutcome.statusClass === "deadline" ||
                            lastOutcome.statusClass === "aborted"
                                ? "timeout"
                                : "provider",
                    }
                  : {}),
            counts: {
                sourceUnits: snapshot?.counts.sourceUnits ?? input.sources.length,
                evidenceBytes:
                    snapshot?.counts.evidenceBytes ??
                    input.sources.reduce(
                        (sum, source) => sum + Buffer.byteLength(source.text, "utf8"),
                        0
                    ),
                // Exact prepared transport bytes only; no HTTP attempt means this stays unknown.
                messageBytes,
                citationsChecked: snapshot?.counts.citationsChecked ?? null,
                citationsFailed: snapshot?.counts.citationsFailed ?? null,
                providerAttempts,
                providerFailures,
            },
        });
        await repository.fail(actor, reserved.id, code, diagnostic);
        console.error("[vantage] candidate not admitted", {
            runId: reserved.id,
            code: diagnostic.code,
            stage: diagnostic.stage,
            statusClass: diagnostic.statusClass,
        });
        if (error instanceof WeeklyReviewConflict) throw error;
        throw new WeeklyReviewConflict("candidate_not_admitted", 409);
    } finally {
        if (runTimer) clearTimeout(runTimer);
    }
}
