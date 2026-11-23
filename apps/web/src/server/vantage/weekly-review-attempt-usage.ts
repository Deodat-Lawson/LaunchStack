import type { ChatProviderAttemptUsageIdentity } from "@launchstack/llm";
import type {
    WeeklyReviewActor,
    WeeklyReviewProviderOutcome,
    WeeklyReviewQuery,
} from "./weekly-review-types";

/** Record sanitized journal usage through the same transaction as settlement. */
export async function recordWeeklyReviewAttemptUsage(
    query: WeeklyReviewQuery,
    actor: WeeklyReviewActor,
    usage: WeeklyReviewProviderOutcome["usage"],
    identity: ChatProviderAttemptUsageIdentity
): Promise<void> {
    let { inputTokens, outputTokens } = usage;
    const { totalTokens, cachedInputTokens, reasoningTokens } = usage;
    // A reported total and one side of its split determine the other side.
    if (totalTokens !== null) {
        if (inputTokens === null && outputTokens !== null && totalTokens >= outputTokens)
            inputTokens = totalTokens - outputTokens;
        if (outputTokens === null && inputTokens !== null && totalTokens >= inputTokens)
            outputTokens = totalTokens - inputTokens;
    }
    const knownTokens = (inputTokens ?? 0) + (outputTokens ?? 0);
    const incomplete = inputTokens === null || outputTokens === null;
    const reportedTotalTokens = Math.max(totalTokens ?? 0, knownTokens);
    if ((incomplete ? reportedTotalTokens : knownTokens) === 0) return;
    if (!query.recordAiUsage) throw new Error("Review attempt usage writer is unavailable.");
    await query.recordAiUsage(
        BigInt(actor.companyId),
        actor.userId,
        {
            ...identity,
            inputTokens: inputTokens ?? 0,
            outputTokens: outputTokens ?? 0,
            ...(cachedInputTokens !== null ? { cachedInputTokens } : {}),
            ...(reasoningTokens !== null ? { reasoningTokens } : {}),
        },
        incomplete ? { reportedTotalTokens } : undefined
    );
}
