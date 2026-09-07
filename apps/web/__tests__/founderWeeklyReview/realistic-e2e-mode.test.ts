import {
    founderWeeklyReviewRealisticExportRoot,
    parseFounderWeeklyReviewRealisticEvidenceMode,
} from "~/server/founder-weekly-review/realistic-e2e-mode";

describe("realistic Founder Weekly Review evidence mode", () => {
    it("preserves legacy mode by default and accepts computed mode explicitly", () => {
        expect(parseFounderWeeklyReviewRealisticEvidenceMode(undefined)).toBe("legacy");
        expect(parseFounderWeeklyReviewRealisticEvidenceMode("legacy")).toBe("legacy");
        expect(parseFounderWeeklyReviewRealisticEvidenceMode("computed")).toBe("computed");
    });

    it("rejects unknown evidence modes before any collection or provider call", () => {
        expect(() => parseFounderWeeklyReviewRealisticEvidenceMode("other")).toThrow(
            "Unsupported FWR_EVIDENCE_MODE"
        );
    });

    it("does not append computed twice when the configured export root already names it", () => {
        expect(
            founderWeeklyReviewRealisticExportRoot(
                "computed",
                ".artifacts/founder-weekly-review/computed"
            )
        ).toBe(".artifacts/founder-weekly-review/computed");
        expect(founderWeeklyReviewRealisticExportRoot("computed", undefined)).toBe(
            ".artifacts/founder-weekly-review/computed"
        );
    });
});
