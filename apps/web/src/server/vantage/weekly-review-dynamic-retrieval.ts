import { WeeklyReviewConflict } from "./weekly-review-types";

export type DynamicRetrievalMode = "baseline" | "role" | "internal-research" | "combined";
export type DynamicRetrievalConfiguration = {
    mode: DynamicRetrievalMode;
    maxFollowUpRounds: 0 | 1;
};
export function dynamicRetrievalConfiguration(
    environment: Record<string, string | undefined> = process.env
): DynamicRetrievalConfiguration {
    const mode = environment.VANTAGE_DYNAMIC_RETRIEVAL_MODE ?? "baseline";
    if (!["baseline", "role", "internal-research", "combined"].includes(mode))
        throw new WeeklyReviewConflict("invalid_retrieval_mode", 400);
    const rounds = environment.VANTAGE_INTERNAL_FOLLOW_UP_ROUNDS ?? "1";
    if (rounds !== "0" && rounds !== "1")
        throw new WeeklyReviewConflict("invalid_internal_follow_up_limit", 400);
    return { mode: mode as DynamicRetrievalMode, maxFollowUpRounds: rounds === "1" ? 1 : 0 };
}
