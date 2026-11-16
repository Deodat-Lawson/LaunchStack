import { weekStartOf, parseIsoDate, toIsoDate } from "@launchstack/pipelines/vantage";
import type { WeeklyReviewStage } from "./weekly-review-client-types";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { isChatRoute } from "@launchstack/llm";
import {
    runWeeklyReviewV21,
    reviewFingerprint,
    type WeeklyReviewInput,
} from "@launchstack/pipelines/vantage/weekly-review-v21";
import { getEngine } from "~/server/engine";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { resolveConfiguredChatModel } from "~/lib/models";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";
import { createWeeklyReviewAuthority } from "./weekly-review-authority";
import { createWeeklyReviewRepository } from "./weekly-review-repository";
import {
    WeeklyReviewConflict,
    type WeeklyReviewDatabase,
    type WeeklyReviewActor,
} from "./weekly-review-types";
import { weeklyReviewTestPorts } from "./weekly-review-test-provider";
import {
    dynamicRetrievalConfiguration,
    type DynamicRetrievalConfiguration,
} from "./weekly-review-dynamic-retrieval";

export function weeklyReviewEnabled() {
    return process.env.VANTAGE_WEEKLY_REVIEW_ENABLED === "true";
}
export function budgetAwareInternalRetrievalEnabled() {
    return process.env.VANTAGE_INTERNAL_RETRIEVAL_V1_ENABLED === "true";
}
export function scopedEvidenceV2Enabled() {
    return (
        budgetAwareInternalRetrievalEnabled() &&
        process.env.VANTAGE_SCOPED_EVIDENCE_V2_ENABLED === "true"
    );
}
export const weeklyReviewDatabase: WeeklyReviewDatabase = {
    async transaction(work) {
        return getEngine().db.transaction(async tx => {
            const query = async (text: string, parameters: unknown[] = []) => {
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
            return work(query);
        });
    },
};
async function currentActor() {
    const result = await requireWorkspaceContext();
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
export function weeklyReviewServices(
    options: { dynamicRetrieval?: DynamicRetrievalConfiguration } = {}
) {
    const authority = createWeeklyReviewAuthority(weeklyReviewDatabase, currentActor, {
        internalRetrievalV1: budgetAwareInternalRetrievalEnabled(),
        scopedEvidenceV2: scopedEvidenceV2Enabled(),
        dynamicRetrieval: options.dynamicRetrieval,
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
    assertWeeklyReviewWeek(args.weekStart);
    const stage = (value: WeeklyReviewStage) => {
        try {
            onStage?.(value);
        } catch {
            /* An observer cannot change the run. */
        }
    };
    if (!weeklyReviewEnabled()) throw new WeeklyReviewConflict("weekly_review_disabled", 404);
    const internalRetrievalV1 = budgetAwareInternalRetrievalEnabled();
    const dynamicRetrieval = dynamicRetrievalConfiguration();
    if (dynamicRetrieval.mode !== "baseline" && !internalRetrievalV1)
        throw new WeeklyReviewConflict("dynamic_retrieval_requires_internal_v1", 409);
    const { authority, repository } = weeklyReviewServices({ dynamicRetrieval });
    const identity = internalRetrievalV1
        ? { candidateId: randomUUID(), asOf: new Date().toISOString() }
        : undefined;
    stage("gathering");
    const context = await authority.collectWeeklyReviewContext(actor, args.weekStart, identity);
    const current = { ...actor, authorityEpoch: context.authorityEpoch };
    const input: WeeklyReviewInput = {
        candidateId: context.inputIdentity?.candidateId ?? randomUUID(),
        week: args.weekStart,
        asOf: context.inputIdentity?.asOf ?? new Date().toISOString(),
        role: context.role,
        mandatoryCoverage: context.mandatoryCoverage,
        sources: context.sources,
        ...(context.scopedEvidence?.length ? { scopedEvidence: context.scopedEvidence } : {}),
        ...(context.retrievalContext ? { retrievalContext: context.retrievalContext } : {}),
    };
    const inputHash = reviewFingerprint({
        week: args.weekStart,
        expectedActiveId: args.expectedActiveId,
        role: context.role,
        sources: context.sources,
        epoch: context.authorityEpoch,
        dynamicRetrieval,
        ...(context.retrievalContext ? { retrievalContext: context.retrievalContext } : {}),
        ...(internalRetrievalV1
            ? { budgetProfile: context.scopedEvidence?.length ? "scoped-v2" : "internal-v1" }
            : {}),
        ...(context.scopedEvidence?.length ? { scopedEvidence: context.scopedEvidence } : {}),
    });
    const dependencies =
        context.dependencies ??
        context.sources.map(({ kind, id, version, hash, purpose }) => ({
            kind,
            id,
            version,
            hash,
            purpose,
        }));
    const reserved = await repository.reserve(
        current,
        args.weekStart,
        args.key,
        inputHash,
        dependencies,
        context.inputIdentity?.candidateId
    );
    if (!reserved.created) {
        if (reserved.status === "accepted") return repository.get(actor, reserved.id);
        throw new WeeklyReviewConflict(
            reserved.status === "failed" ? "review_failed_use_new_key" : "review_dispatch_uncertain"
        );
    }
    input.candidateId = reserved.id;
    const budgetPorts = internalRetrievalV1
        ? {
              budgetProfile: context.scopedEvidence?.length
                  ? ("scoped-v2" as const)
                  : ("internal-v1" as const),
              selectionDiagnostics: context.selectionDiagnostics,
          }
        : {};
    const authorizeDispatch = async (kind: "generation" | "judge") => {
        await repository.authorizeDispatch(current, reserved.id, kind, args.expectedActiveId);
        if (kind === "generation") stage("writing");
    };
    const onGenerationComplete = () => stage("checking");
    try {
        const result = await withWorkspaceChatModels(
            BigInt(actor.companyId),
            { feature: "vantage", userId: actor.userId },
            async () => {
                const test = weeklyReviewTestPorts(input);
                if (test)
                    return runWeeklyReviewV21(input, {
                        ...test,
                        ...budgetPorts,
                        authorizeDispatch,
                        onGenerationComplete,
                    });
                const generationRoute =
                    process.env.VANTAGE_WEEKLY_REVIEW_GENERATION_ROUTE ?? "default";
                const judgeRoute = process.env.VANTAGE_WEEKLY_REVIEW_JUDGE_ROUTE ?? "reasoning";
                if (!isChatRoute(generationRoute) || !isChatRoute(judgeRoute))
                    throw Error("review_model_unavailable");
                const generation = resolveConfiguredChatModel({
                    route: generationRoute,
                    maxRetries: 0,
                    maxOutputTokens: 3600,
                    timeoutMs: 30000,
                });
                const judge = resolveConfiguredChatModel({
                    route: judgeRoute,
                    maxRetries: 0,
                    maxOutputTokens: 6000,
                    timeoutMs: 30000,
                });
                if (
                    generation.behavior.parameters.maxOutputTokens !== "supported" ||
                    judge.behavior.parameters.maxOutputTokens !== "supported"
                )
                    throw Error("review_model_unavailable");
                return runWeeklyReviewV21(input, {
                    generation,
                    judge,
                    ...budgetPorts,
                    authorizeDispatch,
                    onGenerationComplete,
                });
            }
        );
        const report = {
            ...result.report,
            topics: result.report.topics.map((topic, index) => ({
                ...topic,
                id: "topic-" + index,
            })),
        };
        stage("saving");
        await repository.accept(current, reserved.id, {
            report,
            evidence: {
                ...result.evidence,
                retrievalMode: dynamicRetrieval.mode,
                retrievalConfiguration: dynamicRetrieval,
                qualityEvidence:
                    process.env.VANTAGE_WEEKLY_REVIEW_TEST_PROVIDER === "true"
                        ? "injected-deterministic"
                        : "independent-configured-models",
            },
            expectedActiveId: args.expectedActiveId,
        });
        return repository.get(actor, reserved.id);
    } catch (error) {
        await repository.fail(actor, reserved.id, "candidate_not_admitted");
        console.error("[vantage] candidate not admitted", {
            runId: reserved.id,
            code:
                error instanceof WeeklyReviewConflict
                    ? error.code
                    : typeof (error as { code?: unknown })?.code === "string"
                      ? (error as { code: string }).code
                      : typeof (error as { cause?: { code?: unknown } })?.cause?.code === "string"
                        ? (error as { cause: { code: string } }).cause.code
                        : error instanceof Error &&
                            [
                                "invalid_source_citation",
                                "required_context_incomplete",
                                "judge_admission_failed",
                                "independent_judge_required",
                                "context_budget_exceeded",
                                "unsupported_proposal_detail",
                                "invalid_numeric_derivation",
                            ].includes(error.message)
                          ? error.message
                          : error instanceof Error
                            ? error.name
                            : "validation_or_provider_failure",
        });
        if (error instanceof WeeklyReviewConflict) throw error;
        throw new WeeklyReviewConflict("candidate_not_admitted", 409);
    }
}
