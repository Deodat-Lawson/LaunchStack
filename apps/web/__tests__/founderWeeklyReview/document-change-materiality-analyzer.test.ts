import { createHash } from "node:crypto";

import {
    DOCUMENT_CHANGE_MATERIALITY_ANALYZER_LIMITS,
    DOCUMENT_CHANGE_MATERIALITY_ANALYZER_PROMPT_VERSION,
    DocumentChangeMaterialityAnalysisResultSchema,
    DocumentChangeMaterialityAnalyzerError,
    FounderWeeklyReviewEvidenceSnapshotSchema,
    buildDocumentChangeMaterialityAnalysisInput,
    buildFounderWeeklyReviewEvidenceDigest,
    buildFounderWeeklyReviewPrompt,
    buildRawDocumentChanges,
    groupRawDocumentChanges,
    materializeDocumentChanges,
    materializeDocumentChangesWithAnalyzer,
    selectDocumentChangeGroupsForMaterialityAnalysis,
    shouldAnalyzeDocumentChangeGroup,
    type AnalyzedDocumentChangeGroup,
    type ChunkAlignment,
    type DocumentChangeMaterialityAnalysisInput,
    type DocumentChangeMaterialityAnalyzer,
    type VersionChunk,
    type VersionPair,
} from "@launchstack/features/founder-weekly-review";

const pair = (documentId = 1n, day = 2): VersionPair => ({
    documentId,
    documentTitle: `Synthetic operating plan ${documentId}`,
    documentCategory: "Operating plan",
    previousVersionId: 1,
    previousVersionNumber: 1,
    previousCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
    currentVersionId: 2,
    currentVersionNumber: 2,
    currentCreatedAt: new Date(`2026-02-${String(day).padStart(2, "0")}T00:00:00.000Z`),
    currentChangelog: null,
});

const chunk = (
    id: number,
    versionId: bigint,
    documentId: bigint,
    content: string,
    path = "/plan"
): VersionChunk => ({
    chunkId: id,
    versionId,
    documentId,
    content,
    contentHash: null,
    structureId: BigInt(id),
    structurePath: path,
    structureTitle: path.slice(1),
    structureOrdering: id,
    pageNumber: 1,
    lineStart: id * 10,
    lineEnd: id * 10 + 5,
});

const modified = (
    id: number,
    documentId: bigint,
    before: string,
    after: string,
    path = "/plan"
): ChunkAlignment => ({
    changeType: "modified",
    previousChunk: chunk(id, 1n, documentId, before, path),
    currentChunk: chunk(10_000 + id, 2n, documentId, after, path),
    alignmentMethod: "structure_path",
});

function input(documentId: bigint, alignments: ChunkAlignment[], day = 2) {
    return { pair: pair(documentId, day), alignments };
}

function analyzed(
    documentId: bigint,
    alignments: ChunkAlignment[],
    day = 2
): AnalyzedDocumentChangeGroup {
    return materializeDocumentChanges([input(documentId, alignments, day)]).analyzedGroups[0]!;
}

class FakeAnalyzer implements DocumentChangeMaterialityAnalyzer {
    readonly calls: DocumentChangeMaterialityAnalysisInput[] = [];
    constructor(
        private readonly implementation: (input: DocumentChangeMaterialityAnalysisInput) => unknown
    ) {}
    async analyze(value: DocumentChangeMaterialityAnalysisInput) {
        this.calls.push(value);
        return {
            result: await this.implementation(value),
            metadata: {
                provider: "fixture",
                model: "fixture-v1",
                promptVersion: DOCUMENT_CHANGE_MATERIALITY_ANALYZER_PROMPT_VERSION,
            },
        };
    }
}

const materialResult = (summary = "The operating meaning changed.") => ({
    disposition: "material" as const,
    category: "scope_change" as const,
    summary,
    confidence: 0.91,
});

describe("optional document-change materiality analyzer", () => {
    it("uses a conservative semantic-risk gate and bypasses simple factual deltas", () => {
        const uncertainSingle = analyzed(1n, [
            modified(1, 1n, "Telemetry is reliable.", "Reliability is a property of telemetry."),
        ]);
        const uncertainMulti = analyzed(2n, [
            modified(1, 2n, "Telemetry is reliable.", "Reliability is a property of telemetry."),
            modified(2, 2n, "Retries are automatic.", "Automatic retries remain enabled."),
        ]);
        const replacement = analyzed(3n, [
            {
                changeType: "removed",
                previousChunk: chunk(1, 1n, 3n, "The pilot serves invited accounts."),
                alignmentMethod: "unmatched",
            },
            {
                changeType: "added",
                currentChunk: chunk(2, 2n, 3n, "The rollout continues with invited accounts."),
                alignmentMethod: "unmatched",
            },
        ]);
        const complexStrong = analyzed(4n, [
            modified(1, 4n, "Product owns telemetry.", "Platform owns telemetry."),
            modified(
                2,
                4n,
                "Retries follow the established operating process.",
                "The operating process for retries remains established."
            ),
        ]);
        expect(shouldAnalyzeDocumentChangeGroup(uncertainSingle)).toMatchObject({
            eligible: true,
            reason: "uncertain_single_change",
        });
        expect(shouldAnalyzeDocumentChangeGroup(uncertainMulti)).toMatchObject({
            eligible: true,
            reason: "uncertain_multi_change",
        });
        expect(shouldAnalyzeDocumentChangeGroup(replacement)).toMatchObject({ eligible: true });
        expect(shouldAnalyzeDocumentChangeGroup(complexStrong)).toMatchObject({
            eligible: true,
            reason: "complex_multi_change",
        });
        for (const [before, after] of [
            ["Product owns telemetry.", "Platform owns telemetry."],
            ["Launch is planned for Q3.", "Launch is planned for Q4."],
            ["Conversion is 10%.", "Conversion is 25%."],
            ["Admins may enable SSO.", "Admins must enable SSO."],
            ["The migration is planned.", "The migration is launched."],
            ["The plan supports SSO.", "The plan does not support SSO."],
            ["Migration priority: P2", "Migration priority: P0"],
        ]) {
            expect(
                shouldAnalyzeDocumentChangeGroup(analyzed(9n, [modified(1, 9n, before!, after!)]))
            ).toMatchObject({ eligible: false });
        }
        for (const [before, after] of [
            [
                "The launch remains planned for Q3.",
                "We still expect the launch during the third quarter.",
            ],
            ["Product owns telemetry.", "Telemetry is owned by Product."],
            ["ARR target is $1M.", "ARR target is one million dollars."],
            ["The migration is planned.", "The migration is still planned."],
        ]) {
            expect(
                shouldAnalyzeDocumentChangeGroup(analyzed(10n, [modified(1, 10n, before!, after!)]))
            ).toMatchObject({ eligible: true });
        }
    });

    it("selects at most four calls deterministically while retaining document diversity", () => {
        const groups = [1n, 2n, 3n, 4n, 5n].flatMap((documentId, index) => [
            analyzed(
                documentId,
                [
                    modified(
                        1,
                        documentId,
                        "The workflow remains reliable.",
                        "Reliability remains part of the workflow."
                    ),
                ],
                index + 2
            ),
            analyzed(
                documentId,
                [
                    modified(
                        2,
                        documentId,
                        "The plan remains durable.",
                        "Durability remains in the plan.",
                        "/other"
                    ),
                ],
                index + 2
            ),
        ]);
        const forward = selectDocumentChangeGroupsForMaterialityAnalysis(groups);
        const reverse = selectDocumentChangeGroupsForMaterialityAnalysis([...groups].reverse());
        expect(forward.selected).toHaveLength(
            DOCUMENT_CHANGE_MATERIALITY_ANALYZER_LIMITS.callsPerReview
        );
        expect(new Set(forward.selected.map(group => group.group.documentId.toString())).size).toBe(
            4
        );
        expect(reverse.selected.map(group => group.group.groupId)).toEqual(
            forward.selected.map(group => group.group.groupId)
        );
        expect(forward.skipped).toHaveLength(6);
    });

    it("bounds canonical inputs and keeps only changed fragment data", () => {
        const value = "A realistic synthetic operating paragraph. ".repeat(200);
        const group = analyzed(1n, [modified(1, 1n, value, `${value} revised`)]);
        const built = buildDocumentChangeMaterialityAnalysisInput(group);
        expect(built.canonicalCharacterCount).toBeLessThanOrEqual(8_000);
        expect(built.truncated).toBe(true);
        expect(built.input.changes).toHaveLength(1);
        expect(built.input.deterministicAssessment).toEqual(
            expect.objectContaining({
                groupShape: "modified",
                semanticRisk: expect.any(String),
                confirmedFactualDeltas: expect.any(Array),
                possibleSignals: expect.any(Array),
            })
        );
        expect(JSON.stringify(built.input)).not.toContain("customer_feedback");
        expect(built.inputDigest).toMatch(/^[a-f0-9]{64}$/);
    });

    it("freezes material analysis, validates copied key points, and preserves provider-owned provenance boundaries", async () => {
        const analyzer = new FakeAnalyzer(() => ({
            ...materialResult("Rollout scope expanded."),
            beforeKeyPoint: "The pilot is limited to invited accounts.",
            afterKeyPoint: "Invited accounts remain the pilot audience.",
        }));
        const result = await materializeDocumentChangesWithAnalyzer(
            [
                input(1n, [
                    modified(
                        1,
                        1n,
                        "The pilot is limited to invited accounts.",
                        "Invited accounts remain the pilot audience."
                    ),
                ]),
            ],
            analyzer
        );
        expect(analyzer.calls).toHaveLength(1);
        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toMatchObject({
            sourceType: "document_change",
            excerpt: expect.stringContaining("Rollout scope expanded."),
            metadata: expect.objectContaining({
                materialityMethod: "llm",
                category: "scope_change",
            }),
        });
        expect(result.items[0]!.excerpt).toContain("The pilot is limited to invited accounts.");
        expect(result.audit.groups[0]!.analysis).toEqual(
            expect.objectContaining({
                disposition: "material",
                analysisProvider: "fixture",
                analysisModel: "fixture-v1",
                analysisInputDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
            })
        );
        expect(JSON.stringify(result.audit)).not.toContain("rawProviderPayload");
        const snapshot = FounderWeeklyReviewEvidenceSnapshotSchema.parse({
            schemaVersion: "founder-weekly-review-evidence/v2",
            capturedAt: "2026-02-28T00:00:00.000Z",
            reportingPeriod: { start: "2026-02-01", end: "2026-02-28" },
            workspaceTimezone: "UTC",
            items: result.items,
            sourceWarnings: [],
            documentChangeAudit: result.audit,
        });
        const firstPrompt = buildFounderWeeklyReviewPrompt(snapshot);
        const retryPrompt = buildFounderWeeklyReviewPrompt(snapshot);
        expect(retryPrompt).toBe(firstPrompt);
        expect(firstPrompt).not.toContain("analysisInputDigest");
        expect(analyzer.calls).toHaveLength(1);
    });

    it("keeps non-material groups audit-only and retains uncertain groups conservatively", async () => {
        const nonMaterial = new FakeAnalyzer(() => ({
            disposition: "non_material",
            category: "editorial_rewrite",
            summary: "Meaning is unchanged.",
            confidence: 0.95,
        }));
        const pairInput = input(1n, [
            modified(1, 1n, "Product owns telemetry.", "Telemetry is owned by Product."),
        ]);
        const filtered = await materializeDocumentChangesWithAnalyzer([pairInput], nonMaterial);
        expect(filtered.items).toHaveLength(0);
        expect(filtered.audit.rawChanges).toHaveLength(1);
        expect(filtered.audit.groups[0]).toMatchObject({
            evidenceSourceId: null,
            analysis: { disposition: "non_material" },
        });

        const uncertain = new FakeAnalyzer(() => ({
            disposition: "uncertain",
            category: "uncertain",
            summary: "Meaning may have changed.",
            confidence: 0.4,
        }));
        const retained = await materializeDocumentChangesWithAnalyzer([pairInput], uncertain);
        expect(retained.items).toHaveLength(1);
        expect(retained.items[0]!.metadata).toMatchObject({
            materialityMethod: "deterministic",
            category: "uncertain",
        });
        expect(retained.audit.groups[0]!.analysis?.disposition).toBe("uncertain");
    });

    it.each([
        [
            "unavailable",
            new DocumentChangeMaterialityAnalyzerError("unavailable", "offline"),
            "materiality_analyzer_unavailable",
        ],
        [
            "timeout",
            new DocumentChangeMaterialityAnalyzerError("timeout", "slow"),
            "materiality_analysis_timeout",
        ],
        [
            "invalid confidence",
            { disposition: "material", category: "scope_change", summary: "x", confidence: 2 },
            "materiality_result_invalid",
        ],
        ["oversized summary", materialResult("x".repeat(321)), "materiality_result_invalid"],
    ])("falls back deterministically for %s", async (_name, response, warningCode) => {
        const pairInput = input(1n, [
            modified(1, 1n, "Telemetry is reliable.", "Reliability is a property of telemetry."),
        ]);
        const deterministic = materializeDocumentChanges([pairInput]);
        const analyzer = new FakeAnalyzer(() => {
            if (response instanceof Error) throw response;
            return response;
        });
        const result = await materializeDocumentChangesWithAnalyzer([pairInput], analyzer);
        expect(result.items).toEqual(deterministic.items);
        expect(result.warnings.map(warning => warning.code)).toEqual(
            expect.arrayContaining([warningCode, "materiality_analysis_partial"])
        );
    });

    it("keeps the strict concise-output boundary at the documented limits", () => {
        expect(
            DocumentChangeMaterialityAnalysisResultSchema.safeParse(materialResult("x".repeat(320)))
                .success
        ).toBe(true);
        expect(
            DocumentChangeMaterialityAnalysisResultSchema.safeParse(materialResult("x".repeat(321)))
                .success
        ).toBe(false);
        expect(
            DocumentChangeMaterialityAnalysisResultSchema.safeParse({
                ...materialResult(),
                beforeKeyPoint: "b".repeat(240),
                afterKeyPoint: "a".repeat(240),
            }).success
        ).toBe(true);
        expect(
            DocumentChangeMaterialityAnalysisResultSchema.safeParse({
                ...materialResult(),
                beforeKeyPoint: "b".repeat(241),
            }).success
        ).toBe(false);
    });

    it("isolates partial failures and never exceeds concurrency or call budgets", async () => {
        let active = 0;
        let maximumActive = 0;
        const analyzer = new FakeAnalyzer(async value => {
            active++;
            maximumActive = Math.max(maximumActive, active);
            await Promise.resolve();
            active--;
            if (value.documentTitle?.endsWith("2")) throw new Error("synthetic failure");
            return materialResult();
        });
        const inputs = [1n, 2n, 3n, 4n, 5n].map((documentId, index) =>
            input(
                documentId,
                [
                    modified(
                        1,
                        documentId,
                        "The workflow remains reliable.",
                        "Reliability remains part of the workflow."
                    ),
                ],
                index + 2
            )
        );
        const result = await materializeDocumentChangesWithAnalyzer(inputs, analyzer);
        expect(analyzer.calls).toHaveLength(4);
        expect(maximumActive).toBeLessThanOrEqual(2);
        expect(result.analyzerDiagnostics).toMatchObject({
            selectedAnalysisCount: 4,
            skippedByCallBudgetCount: 1,
            failedAnalysisCount: 1,
        });
        expect(result.warnings.map(warning => warning.code)).toEqual(
            expect.arrayContaining([
                "materiality_analysis_budget_truncated",
                "materiality_analysis_partial",
                "materiality_analyzer_unavailable",
            ])
        );
    });

    it("keeps evidence digest distinct from the exact prompt consequence", async () => {
        const pairInput = input(1n, [
            modified(1, 1n, "Product owns telemetry.", "Telemetry is owned by Product."),
        ]);
        const deterministic = materializeDocumentChanges([pairInput]);
        const analyzedResult = await materializeDocumentChangesWithAnalyzer(
            [pairInput],
            new FakeAnalyzer(() => ({
                disposition: "non_material",
                category: "editorial_rewrite",
                summary: "Meaning is unchanged.",
                confidence: 0.94,
            }))
        );
        const snapshot = (items: typeof deterministic.items, audit: typeof deterministic.audit) =>
            FounderWeeklyReviewEvidenceSnapshotSchema.parse({
                schemaVersion: "founder-weekly-review-evidence/v2",
                capturedAt: "2026-02-28T00:00:00.000Z",
                reportingPeriod: { start: "2026-02-01", end: "2026-02-28" },
                workspaceTimezone: "UTC",
                items,
                sourceWarnings: [],
                documentChangeAudit: audit,
            });
        const before = snapshot(deterministic.items, deterministic.audit);
        const after = snapshot(analyzedResult.items, analyzedResult.audit);
        expect(buildFounderWeeklyReviewEvidenceDigest(after)).not.toBe(
            buildFounderWeeklyReviewEvidenceDigest(before)
        );
        const promptHash = (value: typeof before) =>
            createHash("sha256").update(buildFounderWeeklyReviewPrompt(value)).digest("hex");
        expect(promptHash(after)).not.toBe(promptHash(before));
        expect(FounderWeeklyReviewEvidenceSnapshotSchema.parse(after)).toEqual(after);
    });

    it("does not invoke an analyzer when the optional dependency is absent", async () => {
        const pairInput = input(1n, [
            modified(1, 1n, "Telemetry is reliable.", "Reliability is a property of telemetry."),
        ]);
        const deterministic = materializeDocumentChanges([pairInput]);
        const optional = await materializeDocumentChangesWithAnalyzer([pairInput]);
        expect(optional.items).toEqual(deterministic.items);
        expect(optional.audit).toEqual(deterministic.audit);
        expect(optional.warnings).toEqual(deterministic.warnings);
    });

    it("keeps raw/group construction stable before semantic analysis", () => {
        const versionPair = pair();
        const alignment = modified(1, 1n, "Before", "After");
        const raw = buildRawDocumentChanges(versionPair, [alignment]);
        const grouped = groupRawDocumentChanges(versionPair, raw.rawChanges);
        expect(grouped.groups[0]!.rawChanges.map(change => change.rawChangeId)).toEqual(
            raw.rawChanges.map(change => change.rawChangeId)
        );
    });
});
