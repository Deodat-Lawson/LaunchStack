import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import {
    evaluationArtifactDirectory,
    renderMaterialityEvaluationArtifacts,
    runMaterialityAnalyzerEvaluation,
    runMaterialityEvaluation,
} from "../../scripts/founder-weekly-review-materiality-evaluation";
import { FOUNDER_WEEKLY_REVIEW_MATERIALITY_DETERMINISTIC_BASELINE } from "../../scripts/founder-weekly-review-materiality-evaluation-baseline";
import {
    MATERIALITY_EVALUATION_SCENARIOS,
} from "../../scripts/founder-weekly-review-materiality-evaluation-fixtures";

describe("Founder Weekly Review realistic materiality evaluation harness", () => {
    it("loads a compact, stable, human-readable ground-truth matrix", () => {
        expect(MATERIALITY_EVALUATION_SCENARIOS).toHaveLength(46);
        expect(new Set(MATERIALITY_EVALUATION_SCENARIOS.map(scenario => scenario.id)).size).toBe(46);
        expect(MATERIALITY_EVALUATION_SCENARIOS.filter(scenario => scenario.multiChunk).length).toBeGreaterThanOrEqual(10);
        expect(MATERIALITY_EVALUATION_SCENARIOS.filter(scenario => scenario.largeDocument).length).toBeGreaterThanOrEqual(5);
        for (const scenario of MATERIALITY_EVALUATION_SCENARIOS) {
            expect(scenario.description.length).toBeGreaterThan(20);
            expect(scenario.expected.expectedAlignmentRelations.length).toBeGreaterThan(0);
            for (const expectation of [
                ...scenario.expected.meaningfulChanges,
                ...scenario.expected.nonMaterialChanges,
                ...scenario.expected.expectedNoOps,
                ...scenario.expected.expectedAlignmentRelations,
            ]) expect(expectation.id.startsWith(`${scenario.id}:`)).toBe(true);
        }
    });

    it("calculates explicit confusion, alignment, condensation, and budget metrics", () => {
        const result = runMaterialityEvaluation();
        expect(result.summary.scenarioCount).toBe(46);
        expect(result.summary.materiality.groundTruthMaterialChanges).toBeGreaterThan(20);
        expect(result.summary.materiality.groundTruthNonMaterialChanges).toBeGreaterThan(8);
        expect(result.summary.materiality.uncertainRate).toBeGreaterThanOrEqual(0);
        expect(result.summary.materiality.falseMaterialRate).toBeGreaterThanOrEqual(0);
        expect(result.summary.alignment.intendedSemanticRelations).toBeGreaterThan(40);
        expect(result.summary.alignment.alignmentMissRate).toBeGreaterThanOrEqual(0);
        expect(result.summary.condensation.rawChangedRecords).toBeGreaterThan(result.summary.condensation.condensedEvidenceItems);
        expect(result.summary.condensation.reductionRatio).toBeCloseTo(
            result.summary.condensation.rawCopiedCharacters / result.summary.condensation.condensedEvidenceCharacters,
            3
        );
        expect(result.summary.budget.groupBudgetTruncated).toBe(true);
        expect(result.summary.budget.documentDiversityPreserved).toBe(true);
    });

    it("freezes the deterministic-v1 commit, fixture shape, formulas, and exact metrics", () => {
        const result = runMaterialityEvaluation();
        const baseline = FOUNDER_WEEKLY_REVIEW_MATERIALITY_DETERMINISTIC_BASELINE;
        expect(baseline.baselineCommit).toBe("630660fc861e77c464eaffc26ed6f04a7e38e7c7");
        expect(result.summary).toMatchObject({
            fixtureVersion: baseline.fixtureVersion,
            scenarioCount: baseline.scenarioCount,
            multiChunkScenarioCount: baseline.multiChunkScenarioCount,
            largeDocumentScenarioCount: baseline.largeDocumentScenarioCount,
            materiality: {
                categoryAccuracy: baseline.metrics.categoryAccuracy,
                materialRecall: baseline.metrics.materialRecall,
                materialPrecision: baseline.metrics.materialPrecision,
                uncertainRate: baseline.metrics.uncertainRate,
                falseMaterialRate: baseline.metrics.falseMaterialRate,
                missedMaterialRate: baseline.metrics.missedMaterialRate,
                uncertainMaterialRate: baseline.metrics.uncertainMaterialRate,
                uncertainNonMaterialRate: baseline.metrics.uncertainNonMaterialRate,
            },
            alignment: {
                alignmentMissRate: baseline.metrics.alignmentMissRate,
                falseMatchRate: baseline.metrics.alignmentFalseMatchRate,
            },
            condensation: {
                rawChangedRecords: baseline.counts.rawChangedRecords,
                groups: baseline.counts.groups,
                condensedEvidenceItems: baseline.counts.structurallySelectedEvidenceItems,
                rawCopiedCharacters: baseline.counts.rawCopiedCharacters,
                condensedEvidenceCharacters: baseline.counts.condensedCharacters,
                serializedPromptCharacters: baseline.counts.serializedPromptEvidenceCharacters,
                reductionRatio: baseline.counts.reductionRatio,
            },
            budget: { generationEnvelopeSelectedItems: baseline.counts.generationEnvelopeItems },
        });
    });

    it("records all four critical materiality buckets separately", () => {
        const result = runMaterialityEvaluation();
        expect(result.summary.failuresByKind).toEqual(expect.objectContaining({
            materiality_false_positive: expect.any(Number),
            materiality_false_negative: expect.any(Number),
            uncertain_material: expect.any(Number),
            uncertain_non_material: expect.any(Number),
        }));
        expect(result.summary.materiality.falseMaterialCount).toBe(result.summary.failuresByKind.materiality_false_positive);
        expect(result.summary.materiality.missedMaterialCount).toBe(result.summary.failuresByKind.materiality_false_negative);
    });

    it("calculates alignment misses and false matches from explicit intended relations", () => {
        const result = runMaterialityEvaluation();
        expect(result.summary.alignment.alignmentMisses).toBe(result.summary.failuresByKind.alignment_miss);
        expect(result.summary.alignment.falsePairings).toBe(result.summary.failuresByKind.alignment_false_match);
        expect(result.summary.alignment.unmatchedOldChunks).toBeGreaterThanOrEqual(result.summary.alignment.intendedModifiedAsAddedRemoved);
        expect(result.summary.alignment.unmatchedNewChunks).toBeGreaterThanOrEqual(result.summary.alignment.intendedModifiedAsAddedRemoved);
    });

    it("is byte-deterministic when scenario input order changes", () => {
        const forward = runMaterialityEvaluation(MATERIALITY_EVALUATION_SCENARIOS);
        const reversed = runMaterialityEvaluation([...MATERIALITY_EVALUATION_SCENARIOS].reverse());
        expect(renderMaterialityEvaluationArtifacts(reversed)).toEqual(renderMaterialityEvaluationArtifacts(forward));
    });

    it("renders deterministic aggregate, synthetic-failure, and Markdown reports", () => {
        const artifacts = renderMaterialityEvaluationArtifacts(runMaterialityEvaluation());
        expect(JSON.parse(artifacts.summaryJson)).toEqual(expect.objectContaining({
            summary: expect.objectContaining({ scenarioCount: 46 }),
            scenarios: expect.any(Array),
        }));
        const failures = JSON.parse(artifacts.failuresJson) as { failures: Array<{ syntheticFixture: unknown }> };
        expect(failures.failures.length).toBeGreaterThan(0);
        expect(failures.failures.every(failure => failure.syntheticFixture)).toBe(true);
        expect(artifacts.evaluationMarkdown).toContain("## Recommendation");
    });

    it("keeps generated report paths under the repository-gitignored artifact root", () => {
        const directory = evaluationArtifactDirectory("test-run");
        expect(directory.replace(/\\/g, "/")).toContain("/apps/web/.artifacts/founder-weekly-review/materiality-evaluation/test-run");
        execFileSync("git", ["check-ignore", "-q", "apps/web/.artifacts/founder-weekly-review/materiality-evaluation/test-run/summary.json"], {
            cwd: resolve(process.cwd(), "../.."),
        });
    });

    it("runs provider-free even when network access is made fatal", () => {
        const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(() => {
            throw new Error("provider/network invocation is forbidden");
        });
        try {
            expect(() => runMaterialityEvaluation()).not.toThrow();
            expect(fetchSpy).not.toHaveBeenCalled();
        } finally {
            fetchSpy.mockRestore();
        }
    });

    it("evaluates the analyzer strategy offline against the identical frozen fixtures", async () => {
        const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(() => {
            throw new Error("provider/network invocation is forbidden");
        });
        try {
            const forward = await runMaterialityAnalyzerEvaluation(undefined, MATERIALITY_EVALUATION_SCENARIOS);
            const reversed = await runMaterialityAnalyzerEvaluation(undefined, [...MATERIALITY_EVALUATION_SCENARIOS].reverse());
            expect(forward.summary.scenarioCount).toBe(FOUNDER_WEEKLY_REVIEW_MATERIALITY_DETERMINISTIC_BASELINE.scenarioCount);
            expect(forward.summary.groundTruthCategoryDistribution).toEqual(runMaterialityEvaluation().summary.groundTruthCategoryDistribution);
            expect(forward.summary.alignment).toEqual(runMaterialityEvaluation().summary.alignment);
            expect(renderMaterialityEvaluationArtifacts(reversed)).toEqual(renderMaterialityEvaluationArtifacts(forward));
            expect(fetchSpy).not.toHaveBeenCalled();
        } finally {
            fetchSpy.mockRestore();
        }
    });
});
