import type { BaseMessage } from "@langchain/core/messages";
import type { ChatProviderRetryPolicy } from "@launchstack/llm";
import { resolveConfiguredChatModel } from "~/lib/models";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";
import type { VantageV2ModelStage } from "../weekly-review-failure-record";
import { weeklyReviewDatabase } from "../weekly-review-service";
import {
    WeeklyReviewConflict,
    type WeeklyReviewActor,
    type WeeklyReviewQuery,
} from "../weekly-review-types";
import { vantageV2BriefRepository } from "./authority";

export function vantageV2RetryPolicy({
    actor,
    reviewId,
    stage,
    deadlineAt,
    assertAuthority,
}: {
    actor: WeeklyReviewActor;
    reviewId: string;
    stage: VantageV2ModelStage;
    deadlineAt: number;
    assertAuthority?: (query: WeeklyReviewQuery) => Promise<void>;
}): ChatProviderRetryPolicy {
    const repository = vantageV2BriefRepository(actor);
    return {
        deadlineAt,
        usageAccounting: "settlement",
        async beforeAttempt(info) {
            if (info.messageBytes > 200_000)
                throw new WeeklyReviewConflict("provider_input_budget_exceeded");
            const id = await weeklyReviewDatabase.transaction(async query => {
                await query("SET LOCAL statement_timeout='5000ms'");
                await query("SET LOCAL lock_timeout='1000ms'");
                if (assertAuthority) await assertAuthority(query);
                else await repository.readAccepted(query, actor, reviewId, "decision");
                if (Date.now() >= deadlineAt)
                    throw new WeeklyReviewConflict("provider_attempt_timeout", 503);
                return repository.journalAcceptedAttempt(query, actor, reviewId, {
                    stage,
                    ...info,
                });
            });
            return (outcome, identity) =>
                repository.completeProviderAttempt(actor, reviewId, id, outcome, identity);
        },
    };
}

// The Azure default route is Luna. Keep task calls separate from the brief's
// route so its report response schema cannot spill into the task protocol.
export const VANTAGE_V2_MODEL_ROUTE = "default";

export function generateVantageV2Tasks(
    actor: WeeklyReviewActor,
    reviewId: string,
    messages: BaseMessage[]
): Promise<string> {
    const deadlineAt = Date.now() + 90_000;
    return withWorkspaceChatModels(
        BigInt(actor.companyId),
        { feature: "vantage", userId: actor.userId },
        async () => {
            const model = resolveConfiguredChatModel({
                route: VANTAGE_V2_MODEL_ROUTE,
                maxRetries: 0,
                maxOutputTokens: 4200,
                timeoutMs: 90_000,
                providerRetry: vantageV2RetryPolicy({
                    actor,
                    reviewId,
                    stage: "decomposition",
                    deadlineAt,
                }),
            });
            const result = await model.chat.invoke(model.prepareMessages(messages), {
                signal: AbortSignal.timeout(Math.max(1, deadlineAt - Date.now())),
            });
            if (typeof result.content !== "string" || Buffer.byteLength(result.content) > 30_000)
                return "";
            return result.content;
        }
    );
}
