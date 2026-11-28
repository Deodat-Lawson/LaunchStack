import { resolveMemberContext } from "~/lib/require-workspace-context";
import { betaAppsOn } from "~/server/beta-apps";
import { createWeeklyReviewAuthority } from "../weekly-review-authority";
import { createWeeklyReviewRepository } from "../weekly-review-repository";
import { weeklyReviewDatabase } from "../weekly-review-service";
import {
    WeeklyReviewConflict,
    type WeeklyReviewActor,
    type WeeklyReviewQuery,
} from "../weekly-review-types";
import { vantageV2Enabled } from "./enabled";

/** Reuse V1's exact frozen-source checks for the current member named by a task. */
export function vantageV2BriefRepository(actor: WeeklyReviewActor) {
    const authority = createWeeklyReviewAuthority(weeklyReviewDatabase, async query => {
        const executor = query.executor;
        if (!executor || !vantageV2Enabled())
            throw new WeeklyReviewConflict("review_access_denied", 403);
        const companyId = BigInt(actor.companyId);
        const ctx = await resolveMemberContext(actor.userId, companyId, executor);
        if (!ctx || !(await betaAppsOn(companyId, executor)))
            throw new WeeklyReviewConflict("review_access_denied", 403);
        return {
            ...actor,
            role: ctx.role,
            canRead: ctx.can("documents.read"),
            canMutate: ctx.can("documents.edit"),
            documentScope: await ctx.documentScope(),
        };
    });
    return createWeeklyReviewRepository(weeklyReviewDatabase, (query, owner, dependencies, phase) =>
        authority.assertCurrentWeeklyReviewAuthority(query, owner, dependencies, phase)
    );
}

export function assertVantageV2Authority(
    query: WeeklyReviewQuery,
    actor: WeeklyReviewActor,
    reviewId: string,
    phase: "read" | "decision" = "decision"
) {
    return vantageV2BriefRepository(actor).readAccepted(query, actor, reviewId, phase);
}
