/**
 * JudgeResultSchema shape tests: the judge must return exactly one score per
 * rubric criterion — no missing, no duplicated, no unknown criterion ids.
 */

import {
    JUDGE_CRITERIA,
    JudgeResultSchema,
} from "@launchstack/features/marketing-pipeline/benchmark";

function fullScores() {
    return JUDGE_CRITERIA.map(criterion => ({
        criterion,
        score: 50,
        rationale: "calibrated against the reference set",
    }));
}

describe("JudgeResultSchema.scores", () => {
    it("accepts exactly one score per criterion", () => {
        const parsed = JudgeResultSchema.safeParse({
            scores: fullScores(),
            overall: 50,
            summary: "ok",
        });
        expect(parsed.success).toBe(true);
    });

    it("rejects a missing criterion", () => {
        const scores = fullScores().filter(s => s.criterion !== "groundedness");
        const parsed = JudgeResultSchema.safeParse({
            scores,
            overall: 50,
            summary: "ok",
        });
        expect(parsed.success).toBe(false);
        expect(JSON.stringify(parsed.success ? "" : parsed.error.issues)).toContain("groundedness");
    });

    it("rejects a duplicated criterion", () => {
        const scores = [...fullScores(), fullScores()[0]!];
        const parsed = JudgeResultSchema.safeParse({
            scores,
            overall: 50,
            summary: "ok",
        });
        expect(parsed.success).toBe(false);
    });

    it("rejects an unknown criterion id", () => {
        const scores = [...fullScores(), { criterion: "vibes", score: 50, rationale: "nope" }];
        const parsed = JudgeResultSchema.safeParse({
            scores,
            overall: 50,
            summary: "ok",
        });
        expect(parsed.success).toBe(false);
    });
});
