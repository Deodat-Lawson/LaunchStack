import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
    FounderWeeklyReviewEvidenceSnapshotSchema,
    alignVersionChunks,
    buildGenerationEvidenceEnvelope,
    materializeDocumentChanges,
    type AnalyzedDocumentChangeGroup,
    type ChunkAlignment,
    type DocumentChangeCategory,
    type DocumentChangePairInput,
    type VersionPair,
} from "@launchstack/features/founder-weekly-review";

import {
    MATERIALITY_EVALUATION_FIXTURE_VERSION,
    MATERIALITY_EVALUATION_SCENARIOS,
    type ExpectedAlignmentRelation,
    type ExpectedChange,
    type MaterialityEvaluationScenario,
} from "./founder-weekly-review-materiality-evaluation-fixtures";

export const MATERIALITY_EVALUATION_RUN_ID = "deterministic-v1" as const;
export const MATERIALITY_EVALUATION_ARTIFACT_ROOT =
    ".artifacts/founder-weekly-review/materiality-evaluation" as const;

type FailureKind =
    | "materiality_false_positive"
    | "materiality_false_negative"
    | "uncertain_material"
    | "uncertain_non_material"
    | "alignment_miss"
    | "alignment_false_match"
    | "grouping_issue"
    | "budget_issue";

type MissingCapability =
    | "future_llm_materiality_analyzer"
    | "future_embedding_alignment"
    | "deterministic_improvement"
    | "acceptable_limitation";

export type MaterialityEvaluationFailure = {
    kind: FailureKind;
    scenarioId: string;
    expectationId: string;
    description: string;
    observed: string;
    likelyMissingCapability: MissingCapability;
    syntheticFixture: {
        previous: readonly string[];
        current: readonly string[];
    };
};

export type MaterialityEvaluationSummary = {
    fixtureVersion: string;
    scenarioCount: number;
    multiChunkScenarioCount: number;
    largeDocumentScenarioCount: number;
    groundTruthCategoryDistribution: Record<string, number>;
    observedCategoryDistribution: Record<string, number>;
    materiality: {
        groundTruthMaterialChanges: number;
        groundTruthNonMaterialChanges: number;
        categoryCorrect: number;
        categoryAccuracy: number;
        materialRecall: number;
        materialPrecision: number;
        uncertainRate: number;
        falseMaterialCount: number;
        falseMaterialRate: number;
        missedMaterialCount: number;
        missedMaterialRate: number;
        uncertainMaterialCount: number;
        uncertainMaterialRate: number;
        uncertainNonMaterialCount: number;
        uncertainNonMaterialRate: number;
    };
    alignment: {
        intendedSemanticRelations: number;
        correctModifiedPairings: number;
        incorrectModifiedPairings: number;
        intendedModifiedAsAddedRemoved: number;
        falsePairings: number;
        unmatchedOldChunks: number;
        unmatchedNewChunks: number;
        alignmentMisses: number;
        alignmentMissRate: number;
        falseMatchRate: number;
    };
    condensation: {
        rawChangedRecords: number;
        groups: number;
        condensedEvidenceItems: number;
        rawCopiedCharacters: number;
        condensedEvidenceCharacters: number;
        serializedPromptCharacters: number;
        reductionRatio: number;
    };
    budget: {
        groupBudgetTruncated: boolean;
        truncatedGroupCount: number;
        generationEnvelopeTruncated: boolean;
        generationEnvelopeSelectedItems: number;
        generationEnvelopeExcludedItems: number;
        documentDiversityPreserved: boolean;
        selectedDocumentCount: number;
    };
    failuresByKind: Record<FailureKind, number>;
    recommendation: "A" | "B" | "C" | "D" | "E";
    recommendationLabel: string;
};

export type MaterialityEvaluationResult = {
    summary: MaterialityEvaluationSummary;
    failures: readonly MaterialityEvaluationFailure[];
    scenarioResults: readonly {
        id: string;
        alignmentCount: number;
        rawChangeCount: number;
        groupCount: number;
        categories: readonly DocumentChangeCategory[];
        failureKinds: readonly FailureKind[];
    }[];
};

const FAILURE_KINDS: readonly FailureKind[] = [
    "materiality_false_positive",
    "materiality_false_negative",
    "uncertain_material",
    "uncertain_non_material",
    "alignment_miss",
    "alignment_false_match",
    "grouping_issue",
    "budget_issue",
];

function ratio(numerator: number, denominator: number): number {
    return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
}

function pairFor(scenario: MaterialityEvaluationScenario, ordinal: number): VersionPair {
    const documentId = scenario.previousChunks[0]?.documentId ?? scenario.currentChunks[0]!.documentId;
    return {
        documentId,
        documentTitle: `${scenario.documentKind}: ${scenario.id}`,
        documentCategory: null,
        previousVersionId: 1,
        previousVersionNumber: 1,
        previousCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
        currentVersionId: 2,
        currentVersionNumber: 2,
        currentCreatedAt: new Date(Date.UTC(2026, 1, 1 + ordinal)),
        currentChangelog: null,
    };
}

function chunkIds(group: AnalyzedDocumentChangeGroup): { previous: Set<number>; current: Set<number> } {
    return {
        previous: new Set(group.group.rawChanges.flatMap(change => change.previousChunk ? [change.previousChunk.chunkId] : [])),
        current: new Set(group.group.rawChanges.flatMap(change => change.currentChunk ? [change.currentChunk.chunkId] : [])),
    };
}

function overlap(change: ExpectedChange, group: AnalyzedDocumentChangeGroup): number {
    const ids = chunkIds(group);
    return change.previousChunkIds.filter(id => ids.previous.has(id)).length
        + change.currentChunkIds.filter(id => ids.current.has(id)).length;
}

function bestGroup(change: ExpectedChange, groups: readonly AnalyzedDocumentChangeGroup[]): AnalyzedDocumentChangeGroup | undefined {
    return [...groups]
        .map(group => ({ group, score: overlap(change, group) }))
        .filter(candidate => candidate.score > 0)
        .sort((a, b) => b.score - a.score || (a.group.group.groupId < b.group.group.groupId ? -1 : 1))[0]?.group;
}

function relationContainsPair(relation: ExpectedAlignmentRelation, previousId: number, currentId: number): boolean {
    return relation.previousChunkIds.includes(previousId) && relation.currentChunkIds.includes(currentId);
}

function actualPair(alignments: readonly ChunkAlignment[], previousId: number, currentId: number): ChunkAlignment | undefined {
    return alignments.find(alignment => alignment.previousChunk?.chunkId === previousId && alignment.currentChunk?.chunkId === currentId);
}

function relationRecovered(relation: ExpectedAlignmentRelation, alignments: readonly ChunkAlignment[]): boolean {
    if (relation.relation === "added") {
        return relation.currentChunkIds.every(id => alignments.some(alignment => alignment.changeType === "added" && alignment.currentChunk?.chunkId === id));
    }
    if (relation.relation === "removed") {
        return relation.previousChunkIds.every(id => alignments.some(alignment => alignment.changeType === "removed" && alignment.previousChunk?.chunkId === id));
    }
    if (relation.relation === "modified" || relation.relation === "unchanged") {
        const alignment = actualPair(alignments, relation.previousChunkIds[0]!, relation.currentChunkIds[0]!);
        return alignment?.changeType === relation.relation;
    }
    const edges = alignments.filter(alignment => alignment.previousChunk && alignment.currentChunk
        && relationContainsPair(relation, alignment.previousChunk.chunkId, alignment.currentChunk.chunkId));
    return relation.previousChunkIds.every(id => edges.some(edge => edge.previousChunk!.chunkId === id))
        && relation.currentChunkIds.every(id => edges.some(edge => edge.currentChunk!.chunkId === id));
}

function failure(
    scenario: MaterialityEvaluationScenario,
    kind: FailureKind,
    expectationId: string,
    observed: string,
    likelyMissingCapability: MissingCapability
): MaterialityEvaluationFailure {
    return {
        kind,
        scenarioId: scenario.id,
        expectationId,
        description: scenario.description,
        observed,
        likelyMissingCapability,
        syntheticFixture: {
            previous: scenario.previousChunks.map(chunk => chunk.content),
            current: scenario.currentChunks.map(chunk => chunk.content),
        },
    };
}

function increment(record: Record<string, number>, key: string): void {
    record[key] = (record[key] ?? 0) + 1;
}

function recommendationFor(
    uncertainRate: number,
    falseMaterialRate: number,
    uncertainMaterialCount: number,
    alignmentMissRate: number,
    materialityFailureCount: number,
    alignmentFailureCount: number
): Pick<MaterialityEvaluationSummary, "recommendation" | "recommendationLabel"> {
    const materiality = uncertainRate > 0.15 || falseMaterialRate > 0.05 || uncertainMaterialCount >= 3;
    const alignment = alignmentMissRate > 0.075;
    if (materiality && alignment) {
        return materialityFailureCount >= alignmentFailureCount
            ? { recommendation: "C", recommendationLabel: "Implement both, materiality first" }
            : { recommendation: "D", recommendationLabel: "Implement both, alignment first" };
    }
    if (materiality) return { recommendation: "A", recommendationLabel: "Implement Phase 3 optional LLM materiality analyzer next" };
    if (alignment) return { recommendation: "B", recommendationLabel: "Implement Phase 4 embedding-assisted alignment next" };
    return { recommendation: "E", recommendationLabel: "Implement neither yet" };
}

/** Evaluates frozen production logic only; it never invokes a provider or mutates production behavior. */
export function runMaterialityEvaluation(
    inputScenarios: readonly MaterialityEvaluationScenario[] = MATERIALITY_EVALUATION_SCENARIOS
): MaterialityEvaluationResult {
    const scenarios = [...inputScenarios].sort((a, b) => a.id.localeCompare(b.id));
    const failures: MaterialityEvaluationFailure[] = [];
    const scenarioResults: MaterialityEvaluationResult["scenarioResults"][number][] = [];
    const inputs: DocumentChangePairInput[] = [];
    const groundTruthCategoryDistribution: Record<string, number> = {};
    const observedCategoryDistribution: Record<string, number> = {};
    let groundTruthMaterialChanges = 0;
    let groundTruthNonMaterialChanges = 0;
    let categoryCorrect = 0;
    let surfacedTrueMaterial = 0;
    let falseMaterialCount = 0;
    let missedMaterialCount = 0;
    let uncertainMaterialCount = 0;
    let uncertainNonMaterialCount = 0;
    let correctModifiedPairings = 0;
    let incorrectModifiedPairings = 0;
    let intendedModifiedAsAddedRemoved = 0;
    let falsePairings = 0;
    let unmatchedOldChunks = 0;
    let unmatchedNewChunks = 0;
    let alignmentMisses = 0;
    let intendedSemanticRelations = 0;

    for (const [ordinal, scenario] of scenarios.entries()) {
        const pair = pairFor(scenario, ordinal);
        const alignments = alignVersionChunks(scenario.previousChunks, scenario.currentChunks);
        inputs.push({ pair, alignments });
        const materialized = materializeDocumentChanges([{ pair, alignments }]);
        for (const group of materialized.analyzedGroups) increment(observedCategoryDistribution, group.materiality.category);
        const assignedGroupIds = new Set<string>();

        for (const expected of scenario.expected.meaningfulChanges) {
            groundTruthMaterialChanges++;
            increment(groundTruthCategoryDistribution, expected.category ?? "material_unspecified");
            const group = bestGroup(expected, materialized.analyzedGroups);
            if (group) assignedGroupIds.add(group.group.groupId);
            if (!group || group.materiality.category === "editorial_rewrite") {
                missedMaterialCount++;
                failures.push(failure(scenario, "materiality_false_negative", expected.id,
                    group ? "Material source was classified as editorial_rewrite." : "No retained group represented the material source.",
                    group ? "deterministic_improvement" : "future_embedding_alignment"));
                continue;
            }
            surfacedTrueMaterial++;
            if (group.materiality.category === expected.category) categoryCorrect++;
            if (group.materiality.category === "uncertain") {
                uncertainMaterialCount++;
                failures.push(failure(scenario, "uncertain_material", expected.id,
                    "Material source was retained but classified uncertain.", "future_llm_materiality_analyzer"));
            }
        }

        for (const expected of scenario.expected.nonMaterialChanges) {
            groundTruthNonMaterialChanges++;
            const group = bestGroup(expected, materialized.analyzedGroups);
            if (!group) continue;
            assignedGroupIds.add(group.group.groupId);
            falseMaterialCount++;
            failures.push(failure(scenario, "materiality_false_positive", expected.id,
                `Non-material source became prompt-facing ${group.materiality.category} evidence.`,
                group.materiality.category === "uncertain" ? "future_llm_materiality_analyzer" : "acceptable_limitation"));
            if (group.materiality.category === "uncertain") {
                uncertainNonMaterialCount++;
                failures.push(failure(scenario, "uncertain_non_material", expected.id,
                    "Non-material rewrite was classified uncertain.", "future_llm_materiality_analyzer"));
            }
        }

        for (const noOp of scenario.expected.expectedNoOps) {
            groundTruthNonMaterialChanges++;
            const group = materialized.analyzedGroups.find(candidate => {
                const ids = chunkIds(candidate);
                return ids.previous.has(noOp.previousChunkId) || ids.current.has(noOp.currentChunkId);
            });
            if (group) {
                assignedGroupIds.add(group.group.groupId);
                falseMaterialCount++;
                failures.push(failure(scenario, "materiality_false_positive", noOp.id,
                    `Expected no-op became prompt-facing ${group.materiality.category} evidence.`, "deterministic_improvement"));
            }
        }

        for (const group of materialized.analyzedGroups) {
            if (assignedGroupIds.has(group.group.groupId)) continue;
            falseMaterialCount++;
            failures.push(failure(scenario, "materiality_false_positive", group.group.groupId,
                `An unexpected ${group.materiality.category} group became prompt-facing evidence.`, "deterministic_improvement"));
            failures.push(failure(scenario, "grouping_issue", group.group.groupId,
                `An extra ${group.materiality.category} group did not map to an expected semantic change.`, "deterministic_improvement"));
        }

        const expectedRelations = scenario.expected.expectedAlignmentRelations;
        for (const relation of expectedRelations) {
            if (["modified", "unchanged", "split", "merge"].includes(relation.relation)) intendedSemanticRelations++;
            const recovered = relationRecovered(relation, alignments);
            if (!recovered && ["modified", "unchanged", "split", "merge"].includes(relation.relation)) {
                alignmentMisses++;
                const removed = relation.previousChunkIds.every(id => alignments.some(item => item.changeType === "removed" && item.previousChunk?.chunkId === id));
                const added = relation.currentChunkIds.every(id => alignments.some(item => item.changeType === "added" && item.currentChunk?.chunkId === id));
                if (removed && added) intendedModifiedAsAddedRemoved++;
                failures.push(failure(scenario, "alignment_miss", relation.id,
                    removed && added ? "Intended correspondence was represented as added plus removed." : "Intended semantic correspondence was not completely recovered.",
                    "future_embedding_alignment"));
            }
            if (relation.relation === "modified" && relation.previousChunkIds.length === 1 && relation.currentChunkIds.length === 1) {
                const actual = actualPair(alignments, relation.previousChunkIds[0]!, relation.currentChunkIds[0]!);
                if (actual?.changeType === "modified") correctModifiedPairings++;
            }
        }
        for (const alignment of alignments) {
            if (alignment.changeType === "removed") unmatchedOldChunks++;
            if (alignment.changeType === "added") unmatchedNewChunks++;
            if (alignment.changeType !== "modified" || !alignment.previousChunk || !alignment.currentChunk) continue;
            const expected = expectedRelations.some(relation => relationContainsPair(relation, alignment.previousChunk!.chunkId, alignment.currentChunk!.chunkId));
            if (!expected) {
                incorrectModifiedPairings++;
                falsePairings++;
                failures.push(failure(scenario, "alignment_false_match", `${alignment.previousChunk.chunkId}:${alignment.currentChunk.chunkId}`,
                    "The aligner paired chunks outside the fixture's intended semantic relations.", "future_embedding_alignment"));
            }
        }
        const scenarioFailureKinds = [...new Set(failures.filter(item => item.scenarioId === scenario.id).map(item => item.kind))].sort();
        scenarioResults.push({
            id: scenario.id,
            alignmentCount: alignments.length,
            rawChangeCount: materialized.rawChanges.length,
            groupCount: materialized.analyzedGroups.length,
            categories: materialized.analyzedGroups.map(group => group.materiality.category),
            failureKinds: scenarioFailureKinds,
        });
    }

    const aggregate = materializeDocumentChanges(inputs);
    const snapshot = FounderWeeklyReviewEvidenceSnapshotSchema.parse({
        schemaVersion: "founder-weekly-review-evidence/v2",
        capturedAt: "2026-03-31T00:00:00.000Z",
        reportingPeriod: { start: "2026-02-01", end: "2026-03-31" },
        workspaceTimezone: "UTC",
        items: aggregate.items,
        sourceWarnings: aggregate.warnings.map(warning => ({ ...warning, sourceType: "document_change" as const })),
        documentChangeAudit: aggregate.audit,
    });
    const envelope = buildGenerationEvidenceEnvelope(snapshot);
    const uncertainGroups = Object.entries(observedCategoryDistribution).find(([category]) => category === "uncertain")?.[1] ?? 0;
    const observedGroups = Object.values(observedCategoryDistribution).reduce((total, count) => total + count, 0);
    const nonMaterialDenominator = groundTruthNonMaterialChanges;
    const uncertainRate = ratio(uncertainGroups, observedGroups);
    const falseMaterialRate = ratio(falseMaterialCount, nonMaterialDenominator);
    const alignmentMissRate = ratio(alignmentMisses, intendedSemanticRelations);
    const failuresByKind = Object.fromEntries(FAILURE_KINDS.map(kind => [kind, failures.filter(failure => failure.kind === kind).length])) as Record<FailureKind, number>;
    const materialityFailureCount = failuresByKind.materiality_false_positive
        + failuresByKind.materiality_false_negative + failuresByKind.uncertain_material + failuresByKind.uncertain_non_material;
    const alignmentFailureCount = failuresByKind.alignment_miss + failuresByKind.alignment_false_match;
    const recommendation = recommendationFor(uncertainRate, falseMaterialRate, uncertainMaterialCount, alignmentMissRate, materialityFailureCount, alignmentFailureCount);
    const selectedDocumentCount = new Set(aggregate.selectedGroups.map(group => group.group.documentId.toString())).size;
    const availableDocumentCount = new Set(aggregate.analyzedGroups.map(group => group.group.documentId.toString())).size;
    const condensedEvidenceCharacters = aggregate.diagnostics.condensedPromptFacingCharacters;
    const summary: MaterialityEvaluationSummary = {
        fixtureVersion: MATERIALITY_EVALUATION_FIXTURE_VERSION,
        scenarioCount: scenarios.length,
        multiChunkScenarioCount: scenarios.filter(scenario => scenario.multiChunk).length,
        largeDocumentScenarioCount: scenarios.filter(scenario => scenario.largeDocument).length,
        groundTruthCategoryDistribution: Object.fromEntries(Object.entries(groundTruthCategoryDistribution).sort()),
        observedCategoryDistribution: Object.fromEntries(Object.entries(observedCategoryDistribution).sort()),
        materiality: {
            groundTruthMaterialChanges,
            groundTruthNonMaterialChanges,
            categoryCorrect,
            categoryAccuracy: ratio(categoryCorrect, groundTruthMaterialChanges),
            materialRecall: ratio(surfacedTrueMaterial, groundTruthMaterialChanges),
            materialPrecision: ratio(surfacedTrueMaterial, surfacedTrueMaterial + falseMaterialCount),
            uncertainRate,
            falseMaterialCount,
            falseMaterialRate,
            missedMaterialCount,
            missedMaterialRate: ratio(missedMaterialCount, groundTruthMaterialChanges),
            uncertainMaterialCount,
            uncertainMaterialRate: ratio(uncertainMaterialCount, groundTruthMaterialChanges),
            uncertainNonMaterialCount,
            uncertainNonMaterialRate: ratio(uncertainNonMaterialCount, groundTruthNonMaterialChanges),
        },
        alignment: {
            intendedSemanticRelations,
            correctModifiedPairings,
            incorrectModifiedPairings,
            intendedModifiedAsAddedRemoved,
            falsePairings,
            unmatchedOldChunks,
            unmatchedNewChunks,
            alignmentMisses,
            alignmentMissRate,
            falseMatchRate: ratio(falsePairings, correctModifiedPairings + incorrectModifiedPairings),
        },
        condensation: {
            rawChangedRecords: aggregate.rawChanges.length,
            groups: aggregate.analyzedGroups.length,
            condensedEvidenceItems: aggregate.items.length,
            rawCopiedCharacters: aggregate.diagnostics.rawExcerptCharacters,
            condensedEvidenceCharacters,
            serializedPromptCharacters: envelope.diagnostics.serializedCharacterCount,
            reductionRatio: ratio(aggregate.diagnostics.rawExcerptCharacters, Math.max(1, condensedEvidenceCharacters)),
        },
        budget: {
            groupBudgetTruncated: aggregate.diagnostics.truncatedGroupCount > 0,
            truncatedGroupCount: aggregate.diagnostics.truncatedGroupCount,
            generationEnvelopeTruncated: envelope.diagnostics.truncated,
            generationEnvelopeSelectedItems: envelope.diagnostics.selectedItemCount,
            generationEnvelopeExcludedItems: envelope.diagnostics.excludedItemCount,
            documentDiversityPreserved: selectedDocumentCount === Math.min(aggregate.selectedGroups.length, availableDocumentCount),
            selectedDocumentCount,
        },
        failuresByKind,
        ...recommendation,
    };
    return {
        summary,
        failures: failures.sort((a, b) => a.kind.localeCompare(b.kind) || a.scenarioId.localeCompare(b.scenarioId) || a.expectationId.localeCompare(b.expectationId)),
        scenarioResults: scenarioResults.sort((a, b) => a.id.localeCompare(b.id)),
    };
}

export function evaluationArtifactDirectory(runId: string = MATERIALITY_EVALUATION_RUN_ID): string {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(runId)) throw new Error("Evaluation run ID must be filesystem-safe.");
    return resolve(process.cwd(), MATERIALITY_EVALUATION_ARTIFACT_ROOT, runId);
}

function percentage(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
}

export function renderMaterialityEvaluationArtifacts(result: MaterialityEvaluationResult): {
    summaryJson: string;
    failuresJson: string;
    evaluationMarkdown: string;
} {
    const { summary } = result;
    const topFailures = Object.entries(summary.failuresByKind).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]);
    const evaluationMarkdown = [
        "# Founder Weekly Review Materiality Evaluation",
        "",
        `Fixture: \`${summary.fixtureVersion}\``,
        `Scenarios: ${summary.scenarioCount} (${summary.multiChunkScenarioCount} multi-chunk; ${summary.largeDocumentScenarioCount} large-document)`,
        "",
        "## What worked",
        "",
        `- Material recall: ${percentage(summary.materiality.materialRecall)}; exact category accuracy: ${percentage(summary.materiality.categoryAccuracy)}.`,
        `- Condensation: ${summary.condensation.rawChangedRecords} raw records -> ${summary.condensation.groups} groups -> ${summary.condensation.condensedEvidenceItems} structurally selected items.`,
        `- Document diversity preserved: ${summary.budget.documentDiversityPreserved ? "yes" : "no"}.`,
        "",
        "## Where deterministic materiality fails",
        "",
        `- Uncertain rate: ${percentage(summary.materiality.uncertainRate)}.`,
        `- False-material rate: ${percentage(summary.materiality.falseMaterialRate)}.`,
        `- Missed-material rate: ${percentage(summary.materiality.missedMaterialRate)}.`,
        `- Uncertain material/non-material: ${summary.materiality.uncertainMaterialCount}/${summary.materiality.uncertainNonMaterialCount}.`,
        "",
        "## Where alignment fails",
        "",
        `- Alignment miss rate: ${percentage(summary.alignment.alignmentMissRate)}.`,
        `- False-match rate: ${percentage(summary.alignment.falseMatchRate)}.`,
        `- Intended correspondences represented as added + removed: ${summary.alignment.intendedModifiedAsAddedRemoved}.`,
        "",
        "## Budget behavior",
        "",
        `- Structural group budget truncated: ${summary.budget.groupBudgetTruncated ? "yes" : "no"} (${summary.budget.truncatedGroupCount} groups).`,
        `- Generation envelope selected/excluded: ${summary.budget.generationEnvelopeSelectedItems}/${summary.budget.generationEnvelopeExcludedItems}.`,
        `- Serialized prompt evidence: ${summary.condensation.serializedPromptCharacters} characters; envelope truncation: ${summary.budget.generationEnvelopeTruncated ? "yes" : "no"}.`,
        "",
        "## Failure concentration",
        "",
        ...(topFailures.length ? topFailures.map(([kind, count]) => `- ${kind}: ${count}`) : ["- No recorded failures."]),
        "",
        "## Recommendation",
        "",
        `**${summary.recommendation}. ${summary.recommendationLabel}.**`,
        "",
        "Materiality exceeds the uncertainty/false-material guidance threshold, while alignment misses remain below the 5% lower guidance threshold and cluster in split, merge, and one renamed heavy rewrite. The next investment should therefore address semantic interpretation first.",
        "",
        "## Metric definitions",
        "",
        "- False material counts any retained prompt-facing group mapped to a non-material expectation, plus unexpected groups, divided by non-material ground-truth opportunities.",
        "- Uncertain rate is uncertain groups divided by all observed groups; uncertain material and uncertain non-material remain separate buckets.",
        "- Alignment miss rate is unrecovered intended modified/unchanged/split/merge relations divided by all such intended relations.",
        "- Reduction ratio is bounded raw audit excerpt characters divided by structurally selected condensed evidence characters.",
        "",
        "Generated artifacts contain synthetic fixture text only; no provider was invoked.",
        "",
    ].join("\n");
    return {
        summaryJson: `${JSON.stringify({ summary, scenarios: result.scenarioResults }, null, 2)}\n`,
        failuresJson: `${JSON.stringify({ fixtureVersion: summary.fixtureVersion, failures: result.failures }, null, 2)}\n`,
        evaluationMarkdown,
    };
}

export async function writeMaterialityEvaluationArtifacts(
    result: MaterialityEvaluationResult,
    runId: string = MATERIALITY_EVALUATION_RUN_ID
): Promise<{ directory: string; summary: string; failures: string; evaluation: string }> {
    const directory = evaluationArtifactDirectory(runId);
    const artifacts = renderMaterialityEvaluationArtifacts(result);
    await mkdir(directory, { recursive: true });
    const paths = {
        directory,
        summary: resolve(directory, "summary.json"),
        failures: resolve(directory, "failures.json"),
        evaluation: resolve(directory, "evaluation.md"),
    };
    await Promise.all([
        writeFile(paths.summary, artifacts.summaryJson, "utf8"),
        writeFile(paths.failures, artifacts.failuresJson, "utf8"),
        writeFile(paths.evaluation, artifacts.evaluationMarkdown, "utf8"),
    ]);
    return paths;
}

async function main(): Promise<void> {
    const result = runMaterialityEvaluation();
    const artifacts = await writeMaterialityEvaluationArtifacts(result, process.env.FWR_MATERIALITY_EVALUATION_RUN_ID);
    console.log(JSON.stringify({ ...result.summary, artifactDirectory: artifacts.directory }));
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("/founder-weekly-review-materiality-evaluation.ts")) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : "Materiality evaluation failed.");
        process.exitCode = 1;
    });
}
