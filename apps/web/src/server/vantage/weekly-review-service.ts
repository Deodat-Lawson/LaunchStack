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

export function weeklyReviewEnabled() {
    return process.env.VANTAGE_WEEKLY_REVIEW_ENABLED === "true";
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
        documentScope: await ctx.documentScope(),
    };
}
export function weeklyReviewServices() {
    const authority = createWeeklyReviewAuthority(weeklyReviewDatabase, currentActor);
    return {
        authority,
        repository: createWeeklyReviewRepository(
            weeklyReviewDatabase,
            (query, actor, dependencies, phase) => authority.assertCurrentWeeklyReviewAuthority(query, actor, dependencies, phase)
        ),
    };
}
export async function generateWeeklyReview(
    actor: WeeklyReviewActor,
    args: { weekStart: string; key: string; expectedActiveId: string | null }
) {
    if (!weeklyReviewEnabled()) throw new WeeklyReviewConflict("weekly_review_disabled", 404);
    const { authority, repository } = weeklyReviewServices();
    const context = await authority.collectWeeklyReviewContext(actor, args.weekStart);
    const current = { ...actor, authorityEpoch: context.authorityEpoch };
    const input: WeeklyReviewInput = {
        candidateId: randomUUID(),
        week: args.weekStart,
        asOf: new Date().toISOString(),
        role: context.role,
        mandatoryCoverage: context.mandatoryCoverage,
        sources: context.sources,
    };
    const inputHash = reviewFingerprint({
        week: args.weekStart,
        expectedActiveId: args.expectedActiveId,
        role: context.role,
        sources: context.sources,
        epoch: context.authorityEpoch,
    });
    const dependencies = context.sources.map(({ kind, id, version, hash, purpose }) => ({
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
        dependencies
    );
    if (!reserved.created) {
        if (reserved.status === "accepted") return repository.get(actor, reserved.id);
        throw new WeeklyReviewConflict(
            reserved.status === "failed" ? "review_failed_use_new_key" : "review_dispatch_uncertain"
        );
    }
    input.candidateId = reserved.id;
    try {
        const result = await withWorkspaceChatModels(
            BigInt(actor.companyId),
            { feature: "vantage", userId: actor.userId },
            async () => {
                const test = weeklyReviewTestPorts(input);
                if (test)
                    return runWeeklyReviewV21(input, {
                        ...test,
                        authorizeDispatch: kind =>
                            repository.authorizeDispatch(current, reserved.id, kind),
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
                return runWeeklyReviewV21(input, {
                    generation,
                    judge,
                    authorizeDispatch: kind =>
                        repository.authorizeDispatch(current, reserved.id, kind),
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
        await repository.accept(current, reserved.id, {
            report,
            evidence: {
                ...result.evidence,
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
