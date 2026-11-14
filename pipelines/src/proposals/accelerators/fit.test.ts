import { describe, expect, it } from "vitest";

import {
    FIT_DIMENSIONS,
    FIT_RUBRIC_VERSION,
    FitAssessmentV1Schema,
    FitDimensionResultSchema,
    fitFreshness,
    portfolioDimension,
    portfolioRating,
    type PortfolioEvidence,
    type PortfolioMatch,
    programFit,
    summarizeFit,
    type FitAssessmentV1,
    type FitBasis,
    type FitDimensionResult,
    type FitDimensions,
} from "./fit";

const evidence = { sourceIds: ["official"], companyEvidenceIds: [1] };
const rated = (score: 0 | 25 | 50 | 75 | 100): FitDimensionResult => ({
    score,
    applicable: true,
    note: "Rated",
    evidence,
});
const unknown: FitDimensionResult = {
    score: null,
    applicable: true,
    note: "Unknown",
    evidence: { sourceIds: [], companyEvidenceIds: [] },
};
const notApplicable: FitDimensionResult = { ...unknown, applicable: false, note: "Does not apply" };

/** The worked example in the build plan: portfolio does not apply, deal unknown. */
const example: FitDimensions = {
    sector: rated(50),
    stage: rated(25),
    businessModel: rated(75),
    portfolio: notApplicable,
    deal: unknown,
    operations: rated(25),
    value: rated(50),
};

describe("rubric", () => {
    it("weights sum to 100", () => {
        expect(FIT_DIMENSIONS.reduce((sum, { weight }) => sum + weight, 0)).toBe(100);
    });
});

describe("summarizeFit", () => {
    it("matches the worked example", () => {
        // Rated 70 of 85 applicable weight; (50·20 + 25·15 + 75·15 + 25·10 + 50·10) / 70.
        expect(summarizeFit(example)).toEqual({ score: 46, coverage: 82 });
    });

    it("withholds the overall score below the coverage cutoff but keeps coverage", () => {
        // Rated 55 of 85 = 64.7%.
        expect(summarizeFit({ ...example, stage: unknown })).toEqual({ score: null, coverage: 65 });
    });

    it("scores at exactly the cutoff and not just below it", () => {
        // All 100 applicable; rated 20+15+15+10+10 = 70 → exactly 70%.
        const dimensions: FitDimensions = {
            sector: rated(100),
            stage: rated(100),
            businessModel: rated(100),
            portfolio: unknown,
            deal: unknown,
            operations: rated(100),
            value: rated(100),
        };
        expect(summarizeFit(dimensions)).toEqual({ score: 100, coverage: 70 });
        // Rated 60 of 100 → 60%.
        expect(summarizeFit({ ...dimensions, value: unknown })).toEqual({
            score: null,
            coverage: 60,
        });
    });

    it("treats an unknown as missing, not as zero", () => {
        const allButDeal = { ...example, deal: rated(0) };
        // Rating deal 0 lowers the score; leaving it unknown does not.
        expect(summarizeFit(allButDeal).score).toBeLessThan(summarizeFit(example).score!);
    });

    it("gives no score and zero coverage when everything is unknown", () => {
        const all = Object.fromEntries(
            FIT_DIMENSIONS.map(({ key }) => [key, unknown])
        ) as FitDimensions;
        expect(summarizeFit(all)).toEqual({ score: null, coverage: 0 });
    });

    it("gives no score when nothing applies", () => {
        const none = Object.fromEntries(
            FIT_DIMENSIONS.map(({ key }) => [key, notApplicable])
        ) as FitDimensions;
        expect(summarizeFit(none)).toEqual({ score: null, coverage: 0 });
    });
});

describe("FitDimensionResultSchema", () => {
    it("accepts rated, unknown and not-applicable results", () => {
        expect(FitDimensionResultSchema.safeParse(rated(75)).success).toBe(true);
        expect(FitDimensionResultSchema.safeParse(unknown).success).toBe(true);
        expect(FitDimensionResultSchema.safeParse(notApplicable).success).toBe(true);
    });

    it("rejects ratings off the anchors", () => {
        expect(FitDimensionResultSchema.safeParse({ ...rated(50), score: 60 }).success).toBe(false);
    });

    it("rejects a rating without evidence on both sides", () => {
        expect(
            FitDimensionResultSchema.safeParse({
                ...rated(50),
                evidence: { sourceIds: ["official"], companyEvidenceIds: [] },
            }).success
        ).toBe(false);
        expect(
            FitDimensionResultSchema.safeParse({
                ...rated(50),
                evidence: { sourceIds: [], companyEvidenceIds: [1] },
            }).success
        ).toBe(false);
    });

    it("rejects a rating on a dimension that does not apply", () => {
        expect(
            FitDimensionResultSchema.safeParse({ ...rated(50), applicable: false }).success
        ).toBe(false);
    });
});

describe("FitAssessmentV1Schema", () => {
    const assessment = {
        rubricVersion: FIT_RUBRIC_VERSION,
        eligibility: { status: "unknown", note: "Incorporation not stated" },
        dimensions: example,
    };

    it("accepts a complete assessment", () => {
        expect(FitAssessmentV1Schema.safeParse(assessment).success).toBe(true);
    });

    it("requires all seven dimensions and no others", () => {
        const missing: Partial<FitDimensions> = { ...example };
        delete missing.deal;
        expect(
            FitAssessmentV1Schema.safeParse({ ...assessment, dimensions: missing }).success
        ).toBe(false);
        expect(
            FitAssessmentV1Schema.safeParse({
                ...assessment,
                dimensions: { ...example, extra: unknown },
            }).success
        ).toBe(false);
    });

    it("rejects another rubric version and the old single-score shape", () => {
        expect(
            FitAssessmentV1Schema.safeParse({ ...assessment, rubricVersion: "fit-v0" }).success
        ).toBe(false);
        expect(
            FitAssessmentV1Schema.safeParse({
                score: 70,
                reasons: [],
                concerns: [],
                unknowns: [],
                sourceIds: [],
                companyEvidenceIds: [],
            }).success
        ).toBe(false);
    });
});

describe("fitFreshness", () => {
    const saved: FitBasis = {
        profileHash: "p1",
        programHash: "g1",
        rubricVersion: FIT_RUBRIC_VERSION,
        checkedAt: "2026-11-09T10:00:00Z",
    };
    const current = { profileHash: "p1", programHash: "g1" };

    it("is not assessed with no saved result", () => {
        expect(fitFreshness(null, current)).toEqual({
            status: "not_assessed",
            reasons: [],
            assessedAt: null,
        });
    });

    it("is current when nothing changed", () => {
        expect(fitFreshness(saved, current)).toEqual({
            status: "current",
            reasons: [],
            assessedAt: saved.checkedAt,
        });
    });

    it.each([
        [{ ...current, profileHash: "p2" }, saved, ["profile_changed"]],
        [{ ...current, profileHash: null }, saved, ["profile_changed"]],
        [{ ...current, programHash: "g2" }, saved, ["program_changed"]],
        [current, { ...saved, rubricVersion: "fit-v0" }, ["rubric_changed"]],
        // Rows saved before fit-v1 have no rubric version.
        [current, { ...saved, rubricVersion: null }, ["rubric_changed"]],
        [
            { profileHash: "p2", programHash: "g2" },
            { ...saved, rubricVersion: null },
            ["profile_changed", "program_changed", "rubric_changed"],
        ],
    ] as const)("is out of date with the right reasons (%#)", (now, basis, reasons) => {
        expect(fitFreshness(basis, now)).toEqual({
            status: "out_of_date",
            reasons,
            assessedAt: saved.checkedAt,
        });
    });
});

describe("portfolioDimension", () => {
    const match = (name: string, similarity: number): PortfolioMatch => ({
        companyId: `y-combinator:${name.toLowerCase()}`,
        name,
        batch: "Winter 2021",
        similarity,
        sharedTerms: [],
    });
    const lookup = (found: PortfolioEvidence) => () => Promise.resolve(found);

    it("asks about the Program it grades", async () => {
        const asked: string[] = [];
        await portfolioDimension("y-combinator", id => {
            asked.push(id);
            return Promise.resolve({ supported: false });
        });
        expect(asked).toEqual(["y-combinator"]);
    });

    it("does not apply outside the Supported set and leaves the total", async () => {
        const portfolio = await portfolioDimension("antler", lookup({ supported: false }));
        expect(portfolio).toMatchObject({ score: null, applicable: false });
        expect(FitDimensionResultSchema.safeParse(portfolio).success).toBe(true);
        expect(summarizeFit({ ...example, portfolio })).toEqual(summarizeFit(example));
    });

    it("is unknown, not inapplicable, for a Supported Program without matches", async () => {
        const portfolio = await portfolioDimension(
            "y-combinator",
            lookup({ supported: true, matches: [], companyEvidenceIds: [1] })
        );
        expect(portfolio).toMatchObject({ score: null, applicable: true });
        expect(FitDimensionResultSchema.safeParse(portfolio).success).toBe(true);
        // Unknown stays in the total and lowers coverage.
        expect(summarizeFit({ ...example, portfolio }).coverage).toBeLessThan(
            summarizeFit(example).coverage
        );
    });

    it("is unknown when no profile excerpt backs the compared text", async () => {
        const portfolio = await portfolioDimension(
            "y-combinator",
            lookup({ supported: true, matches: [match("Acme", 0.7)], companyEvidenceIds: [] })
        );
        expect(portfolio).toMatchObject({ score: null, applicable: true });
    });

    it("rates a Supported Program from its nearest past companies, citing them", async () => {
        const matches = [0.66, 0.64, 0.62, 0.6, 0.58, 0.2].map((similarity, index) =>
            match(`Company${index}`, similarity)
        );
        const portfolio = await portfolioDimension(
            "y-combinator",
            lookup({ supported: true, matches, companyEvidenceIds: [4, 1, 4] })
        );
        expect(portfolio).toMatchObject({
            score: 75,
            applicable: true,
            evidence: { sourceIds: [], companyEvidenceIds: [1, 4] },
        });
        expect(portfolio.evidence.portfolioCompanies).toEqual(matches.slice(0, 5));
        expect(portfolio.note).toContain("Company0");
        expect(FitDimensionResultSchema.safeParse(portfolio).success).toBe(true);
    });

    it.each([
        [0.7, 100],
        [0.68, 100],
        [0.6, 75],
        [0.55, 50],
        [0.45, 25],
        [-0.1, 25],
    ] as const)("maps mean similarity %s to %s and never to 0", (similarity, score) => {
        expect(portfolioRating([{ similarity }])).toEqual({ score, similarity });
    });

    it("has no rating without matches", () => {
        expect(portfolioRating([])).toEqual({ score: null, similarity: null });
    });
});

describe("programFit", () => {
    const assessment: FitAssessmentV1 = {
        rubricVersion: FIT_RUBRIC_VERSION,
        eligibility: { status: "eligible", note: "No failed requirement" },
        dimensions: example,
    };
    const basis: FitBasis = {
        profileHash: "p1",
        programHash: "g1",
        rubricVersion: FIT_RUBRIC_VERSION,
        checkedAt: "2026-11-09T10:00:00Z",
    };
    const current = { profileHash: "p1", programHash: "g1" };

    it("is not assessed without a saved row", () => {
        expect(programFit(null, current)).toEqual({
            fit: null,
            freshness: { status: "not_assessed", reasons: [], assessedAt: null },
        });
    });

    it("serves the grades with the computed overall result", () => {
        const { fit, freshness } = programFit({ ...basis, assessment }, current);
        expect(fit).toEqual({ ...assessment, overall: { score: 46, coverage: 82 } });
        expect(freshness.status).toBe("current");
    });

    it("keeps out-of-date grades visible, with the reason", () => {
        const { fit, freshness } = programFit(
            { ...basis, assessment },
            { ...current, programHash: "g2" }
        );
        expect(fit?.overall.score).toBe(46);
        expect(freshness).toMatchObject({ status: "out_of_date", reasons: ["program_changed"] });
    });

    it("shows no grades for an unreadable row, even if it claims the current rubric", () => {
        expect(programFit({ ...basis, assessment: null }, current)).toEqual({
            fit: null,
            freshness: {
                status: "out_of_date",
                reasons: ["rubric_changed"],
                assessedAt: basis.checkedAt,
            },
        });
    });
});
