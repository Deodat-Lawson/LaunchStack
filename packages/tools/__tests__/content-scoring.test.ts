import { describe, expect, it } from "vitest";
import {
    buildJudgeHumanPrompt,
    JUDGE_CRITERIA,
    JudgeResultSchema,
    QUALITY_THRESHOLD,
} from "@launchstack/tools/content-scoring";

function fullScores(overrides: Partial<Record<string, number>> = {}) {
    return JUDGE_CRITERIA.map(criterion => ({
        criterion,
        score: overrides[criterion] ?? 50,
        rationale: "r",
    }));
}

describe("JudgeResultSchema", () => {
    it("accepts exactly one score per criterion", () => {
        const parsed = JudgeResultSchema.safeParse({
            scores: fullScores(),
            overall: 50,
            summary: "ok",
        });
        expect(parsed.success).toBe(true);
    });

    it("rejects a missing criterion", () => {
        const scores = fullScores().slice(1);
        const parsed = JudgeResultSchema.safeParse({ scores, overall: 50, summary: "ok" });
        expect(parsed.success).toBe(false);
    });

    it("rejects duplicate criteria", () => {
        const scores = [...fullScores(), fullScores()[0]!];
        const parsed = JudgeResultSchema.safeParse({ scores, overall: 50, summary: "ok" });
        expect(parsed.success).toBe(false);
    });
});

describe("buildJudgeHumanPrompt", () => {
    it("carries the reference, context, candidate, and every criterion", () => {
        const prompt = buildJudgeHumanPrompt({
            platform: "x",
            referenceMarkdown: "REFERENCE-BLOCK",
            companyContext: "CONTEXT-BLOCK",
            post: "CANDIDATE-POST",
        });
        expect(prompt).toContain("PLATFORM: x");
        expect(prompt).toContain("REFERENCE-BLOCK");
        expect(prompt).toContain("CONTEXT-BLOCK");
        expect(prompt).toContain("CANDIDATE-POST");
        for (const criterion of JUDGE_CRITERIA) {
            expect(prompt).toContain(`- ${criterion}:`);
        }
    });
});

describe("quality gate", () => {
    it("keeps the pre-extraction threshold", () => {
        expect(QUALITY_THRESHOLD).toBe(6);
    });
});
