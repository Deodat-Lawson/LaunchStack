import { describe, expect, it } from "vitest";
import { buildVariantRanking } from "@launchstack/tools/content-scoring";

function q(score: number, issues: string[] = []) {
    return { score, issues, rewrite: null };
}

describe("buildVariantRanking", () => {
    it("picks the highest score", () => {
        const ranking = buildVariantRanking([q(5), q(8), q(6)]);
        expect(ranking.bestIndex).toBe(1);
        expect(ranking.scores).toHaveLength(3);
        expect(ranking.scores[1]).toMatchObject({ index: 1, score: 8 });
    });

    it("ties go to the earliest variant (stable vs pre-ranking order)", () => {
        expect(buildVariantRanking([q(7), q(7), q(7)]).bestIndex).toBe(0);
    });

    it("a failed scoring (null) never wins, but survivors still rank", () => {
        const ranking = buildVariantRanking([null, q(4), q(9)]);
        expect(ranking.bestIndex).toBe(2);
        expect(ranking.scores[0]).toMatchObject({ index: 0, score: null });
    });

    it("all scoring failed falls back to index 0 (the pre-ranking behavior)", () => {
        expect(buildVariantRanking([null, null]).bestIndex).toBe(0);
    });

    it("carries issues through for the wire", () => {
        const ranking = buildVariantRanking([q(3, ["weak hook"])]);
        expect(ranking.scores[0]!.issues).toEqual(["weak hook"]);
    });
});
