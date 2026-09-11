export type FounderWeeklyReviewRealisticEvidenceMode = "legacy" | "computed";

/** Explicit runner-only mode selection; default preserves the legacy baseline. */
export function parseFounderWeeklyReviewRealisticEvidenceMode(
    raw: string | undefined
): FounderWeeklyReviewRealisticEvidenceMode {
    if (!raw || raw === "legacy") return "legacy";
    if (raw === "computed") return "computed";
    throw new Error(`Unsupported FWR_EVIDENCE_MODE: ${raw}`);
}

/** Keeps an explicit export root from receiving the evidence mode twice. */
export function founderWeeklyReviewRealisticExportRoot(
    mode: FounderWeeklyReviewRealisticEvidenceMode,
    configuredRoot: string | undefined
): string {
    return configuredRoot ?? `.artifacts/founder-weekly-review/${mode}`;
}
