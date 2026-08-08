import {
    FounderWeeklyReviewEvidenceSnapshotSchema,
    analyzeDocumentChangeFactualDeltas,
    analyzeDocumentChangeGroup,
    buildCondensedDocumentChangeEvidence,
    buildFounderWeeklyReviewEvidenceDigest,
    buildFounderWeeklyReviewPrompt,
    buildGenerationEvidenceEnvelope,
    buildRawDocumentChanges,
    generateFounderWeeklyReview,
    groupRawDocumentChanges,
    materializeDocumentChanges,
    resolveDocumentChangeEvidenceAudit,
    selectMaterialDocumentChangeGroups,
    type AnalyzedDocumentChangeGroup,
    type ChunkAlignment,
    type DocumentChangeCategory,
    type VersionChunk,
    type VersionPair,
} from "@launchstack/features/founder-weekly-review";

const pair = (documentId = 1n, previousVersionId = 1, currentVersionId = 2, currentDate = "2026-02-02T00:00:00.000Z"): VersionPair => ({
    documentId,
    documentTitle: `Document ${documentId}`,
    documentCategory: "Product",
    previousVersionId,
    previousVersionNumber: previousVersionId,
    previousCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
    currentVersionId,
    currentVersionNumber: currentVersionId,
    currentCreatedAt: new Date(currentDate),
    currentChangelog: null,
});

const chunk = (id: number, versionId: bigint, content: string, overrides: Partial<VersionChunk> = {}): VersionChunk => ({
    chunkId: id,
    versionId,
    documentId: 1n,
    content,
    contentHash: null,
    structureId: BigInt(id),
    structurePath: `/section-${id}`,
    structureTitle: `Section ${id}`,
    structureOrdering: id,
    pageNumber: id,
    lineStart: id * 10,
    lineEnd: id * 10 + 5,
    ...overrides,
});

const modified = (id: number, before: string, after: string, overrides: Partial<VersionChunk> = {}): ChunkAlignment => ({
    changeType: "modified",
    previousChunk: chunk(id, 1n, before, overrides),
    currentChunk: chunk(10_000 + id, 2n, after, overrides),
    alignmentMethod: "structure_path",
});

function groupFor(before: string, after: string, id = 1, versionPair = pair()) {
    const raw = buildRawDocumentChanges(versionPair, [modified(id, before, after, { documentId: versionPair.documentId })]).rawChanges;
    return groupRawDocumentChanges(versionPair, raw).groups[0]!;
}

function analyzed(category: DocumentChangeCategory, documentId: bigint, index: number, currentDate = "2026-02-02T00:00:00.000Z"): AnalyzedDocumentChangeGroup {
    const versionPair = pair(documentId, 1, 2, currentDate);
    const group = groupFor(`before ${documentId}-${index}`, `after ${documentId}-${index}`, Number(documentId) * 100 + index, versionPair);
    const priority = ["ownership_change", "status_change", "deadline_change", "metric_change", "requirement_change", "risk_or_blocker_change", "scope_change", "priority_change", "uncertain", "editorial_rewrite"].indexOf(category) + 1;
    return { pair: versionPair, group, materiality: { category, priority, confidence: category === "uncertain" ? "uncertain" : "strong", signals: [`${category}_test`] } };
}

describe("deterministic document-change materiality", () => {
    it.each([
        ["Product", "Platform", "ownership_change"],
        ["Product owns retry telemetry", "Platform owns retry telemetry", "ownership_change"],
        ["planned", "launched", "status_change"],
        ["Q3", "Q4", "deadline_change"],
        ["June 1", "July 15", "deadline_change"],
        ["10% conversion", "25% conversion", "metric_change"],
        ["$1M ARR", "$750k ARR", "metric_change"],
        ["optional", "required", "requirement_change"],
        ["may launch", "must launch", "requirement_change"],
        ["blocked", "resolved", "risk_or_blocker_change"],
        ["P2", "P0", "priority_change"],
        ["US only", "global", "scope_change"],
    ] as const)("classifies %s → %s as %s", (before, after, category) => {
        expect(analyzeDocumentChangeGroup(groupFor(before, after))).toMatchObject({ category });
    });

    it("uses explicit precedence when multiple signals occur", () => {
        const result = analyzeDocumentChangeGroup(groupFor(
            "Product owns a planned Q3 launch for 10% of customers",
            "Platform owns a launched Q4 release for 25% of customers"
        ));
        expect(result).toMatchObject({
            category: "ownership_change",
            priority: 1,
            signals: expect.arrayContaining(["ownership_subject_changed", "status_term_changed", "date_or_deadline_changed", "numeric_metric_changed"]),
        });
    });

    it("keeps punctuation, capitalization, and paraphrase changes uncertain while retaining negation", () => {
        expect(analyzeDocumentChangeGroup(groupFor("Launch.", "Launch!"))).toMatchObject({ category: "uncertain" });
        expect(analyzeDocumentChangeGroup(groupFor("Product roadmap", "product roadmap"))).toMatchObject({ category: "uncertain" });
        expect(analyzeDocumentChangeGroup(groupFor("Reliable export retries", "Export retries are reliable"))).toMatchObject({ category: "uncertain" });
        expect(analyzeDocumentChangeGroup(groupFor("supports exports", "does not support exports"))).toMatchObject({
            category: "requirement_change",
            signals: expect.arrayContaining(["negation_changed"]),
        });
    });

    it.each([
        ["Q3", "Q4", "deadline", "changed"],
        ["Q3", "third quarter", "deadline", "equivalent"],
        ["Product owns telemetry.", "Platform owns telemetry.", "ownership", "changed"],
        ["Product owns telemetry.", "Telemetry is owned by Product.", "ownership", "equivalent"],
        ["10% conversion", "25% conversion", "metric", "changed"],
        ["ARR target is $1M.", "ARR target is one million dollars.", "metric", "equivalent"],
        ["The migration is planned.", "The migration is launched.", "status", "changed"],
        ["The migration is planned.", "The migration is still planned.", "status", "equivalent"],
    ] as const)("compares factual state in %s -> %s as %s %s", (before, after, kind, relation) => {
        const group = groupFor(before, after);
        const deterministic = analyzeDocumentChangeGroup(group);
        const assessment = analyzeDocumentChangeFactualDeltas(group, deterministic.signals);
        expect(assessment.factualComparisons).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind, relation }),
        ]));
    });

    it("keeps one-sided business signals unconfirmed rather than manufacturing a delta", () => {
        const versionPair = pair();
        const raw = buildRawDocumentChanges(versionPair, [{
            changeType: "added",
            currentChunk: chunk(2, 2n, "Admins must enable SSO."),
            alignmentMethod: "unmatched",
        }]).rawChanges;
        const group = groupRawDocumentChanges(versionPair, raw).groups[0]!;
        const deterministic = analyzeDocumentChangeGroup(group);
        const assessment = analyzeDocumentChangeFactualDeltas(group, deterministic.signals);
        expect(assessment.confirmedFactualDeltas).toHaveLength(0);
        expect(assessment.possibleSignals).toContain("requirement");
        expect(assessment.factualComparisons).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: "requirement", relation: "unknown" }),
        ]));
    });

    it("assigns editorial only to a narrow deterministic formatting rewrite", () => {
        expect(analyzeDocumentChangeGroup(groupFor("- First item", "* First item"))).toMatchObject({
            category: "editorial_rewrite",
            confidence: "moderate",
        });
    });

    it("builds one stable bounded group item with copied spans and complete audit membership", () => {
        const versionPair = pair();
        const alignments: ChunkAlignment[] = [
            modified(1, "Product owns retry telemetry.", "Platform owns retry telemetry.", { structurePath: "/ownership", structureTitle: "Ownership" }),
            modified(2, "Product owns alerting.", "Platform owns alerting.", { structurePath: "/ownership", structureTitle: "Ownership" }),
            { changeType: "removed", previousChunk: chunk(3, 1n, "Product owns paging.", { structurePath: "/ownership", structureTitle: "Ownership" }), alignmentMethod: "unmatched" },
            { changeType: "added", currentChunk: chunk(4, 2n, "Platform owns paging.", { structurePath: "/ownership", structureTitle: "Ownership" }), alignmentMethod: "unmatched" },
        ];
        const result = materializeDocumentChanges([{ pair: versionPair, alignments }]);
        const item = result.items[0]!;
        const auditGroup = result.audit.groups[0]!;

        expect(result.items).toHaveLength(1);
        expect(item).toEqual(buildCondensedDocumentChangeEvidence(versionPair, result.selectedGroups[0]!.group, result.selectedGroups[0]!.materiality));
        expect(item.sourceId).toMatch(/^document_change:group:[a-f0-9]{64}$/);
        expect(item.metadata).toMatchObject({ category: "ownership_change", materialityMethod: "deterministic", rawChangeCount: 4 });
        expect(item.excerpt).toContain("Product owns retry telemetry.");
        expect(item.excerpt).toContain("Platform owns retry telemetry.");
        expect(item.excerpt).toContain("Section changed across 4 source fragments.");
        expect(item.excerpt.length).toBeLessThanOrEqual(1800);
        expect(auditGroup.rawChangeIds).toHaveLength(4);
        expect(auditGroup.evidenceSourceId).toBe(item.sourceId);
        expect(result.audit.rawChanges).toHaveLength(4);
        expect(new Set(auditGroup.rawChangeIds)).toEqual(new Set(result.audit.rawChanges.map(change => change.rawChangeId)));
        expect(result.audit.rawChanges.find(change => change.changeType === "modified")).toEqual(expect.objectContaining({
            documentId: "1", previousVersionId: 1, currentVersionId: 2,
            alignmentMethod: expect.any(String), processingVersion: "raw-document-change/v1",
            previousHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }));
        const snapshot = FounderWeeklyReviewEvidenceSnapshotSchema.parse({
            schemaVersion: "founder-weekly-review-evidence/v2", capturedAt: "2026-02-28T00:00:00.000Z",
            reportingPeriod: { start: "2026-02-01", end: "2026-02-28" }, workspaceTimezone: "UTC",
            items: result.items, sourceWarnings: [], documentChangeAudit: result.audit,
        });
        const promptItem = buildGenerationEvidenceEnvelope(snapshot).items[0]!;
        expect(promptItem.metadata).toMatchObject({ category: "ownership_change", materialityMethod: "deterministic", materialityConfidence: "strong", structureTitle: "Ownership", rawChangeCount: 4 });
        expect(promptItem.metadata).not.toHaveProperty("groupId");
    });

    it("preserves concise single-change before/after semantics", () => {
        const versionPair = pair();
        const result = materializeDocumentChanges([{ pair: versionPair, alignments: [modified(1, "planned", "shipped")] }]);
        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toMatchObject({ sourceType: "document_change", metadata: expect.objectContaining({ category: "status_change", rawChangeCount: 1 }) });
        expect(result.items[0]!.excerpt).toContain("Before:\n- planned");
        expect(result.items[0]!.excerpt).toContain("After:\n- shipped");
    });

    it("selects by materiality within documents while preserving document diversity and final chronology", () => {
        const candidates: AnalyzedDocumentChangeGroup[] = [];
        for (const documentId of [1n, 2n, 3n, 4n]) {
            candidates.push(analyzed("ownership_change", documentId, 1, "2026-02-09T00:00:00.000Z"));
            candidates.push(analyzed("status_change", documentId, 2, "2026-02-08T00:00:00.000Z"));
            candidates.push(analyzed("deadline_change", documentId, 3, "2026-02-07T00:00:00.000Z"));
            candidates.push(analyzed("metric_change", documentId, 4, "2026-02-06T00:00:00.000Z"));
            candidates.push(analyzed("requirement_change", documentId, 5, "2026-02-05T00:00:00.000Z"));
            candidates.push(analyzed("uncertain", documentId, 6, "2026-02-04T00:00:00.000Z"));
            candidates.push(analyzed("editorial_rewrite", documentId, 7, "2026-02-03T00:00:00.000Z"));
        }
        const selected = selectMaterialDocumentChangeGroups([...candidates].reverse());
        const counts = new Map<string, number>();
        for (const entry of selected.selectedGroups) counts.set(entry.group.documentId.toString(), (counts.get(entry.group.documentId.toString()) ?? 0) + 1);

        expect(selected.selectedGroups).toHaveLength(24);
        expect([...counts.values()]).toEqual([6, 6, 6, 6]);
        expect(selected.selectedGroups.some(entry => entry.materiality.category === "editorial_rewrite")).toBe(false);
        expect(selected.selectedGroups.filter(entry => entry.materiality.category === "ownership_change")).toHaveLength(4);
        expect(selected.selectedGroups.map(entry => entry.pair.currentCreatedAt.getTime())).toEqual(
            [...selected.selectedGroups].map(entry => entry.pair.currentCreatedAt.getTime()).sort((a, b) => a - b)
        );
    });

    it("enforces eight per document and pair and prefers newer equal-category events", () => {
        const candidates = Array.from({ length: 9 }, (_, index) => analyzed(
            "uncertain",
            1n,
            index + 1,
            `2026-02-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`
        ));
        const selected = selectMaterialDocumentChangeGroups(candidates);
        expect(selected.selectedGroups).toHaveLength(8);
        expect(selected.truncatedGroups).toHaveLength(1);
        expect(selected.truncatedGroups[0]!.pair.currentCreatedAt.toISOString()).toBe("2026-02-01T00:00:00.000Z");
        expect(selected.warnings).toContainEqual(expect.objectContaining({ code: "document_change_budget_truncated" }));
    });

    it("condenses the 40-chunk enterprise scenario while retaining every raw audit record", () => {
        const versionPair = pair(44n);
        const alignments: ChunkAlignment[] = [];
        for (let index = 0; index < 20; index++) {
            const content = `unchanged source fragment ${index}`;
            alignments.push({
                changeType: "unchanged",
                previousChunk: chunk(index + 1, 1n, content, { documentId: 44n, pageNumber: index + 1, structurePath: `/unchanged-${index}` }),
                currentChunk: chunk(1001 + index, 2n, content, { documentId: 44n, pageNumber: index + 1, structurePath: `/unchanged-${index}` }),
                alignmentMethod: "content_hash",
            });
        }
        for (let index = 0; index < 5; index++) alignments.push(modified(100 + index, `wrapped line ${index}`, `  wrapped\r\n line\u00a0${index}  `, { documentId: 44n, structurePath: `/noop-${index}` }));
        alignments.push(modified(201, "Product owns retry telemetry.", "Platform owns retry telemetry.", { documentId: 44n, structurePath: "/ownership", structureTitle: "Ownership" }));
        alignments.push(modified(202, "Launch deadline is Q3.", "Launch deadline is Q4.", { documentId: 44n, structurePath: "/deadline", structureTitle: "Deadline" }));
        alignments.push(modified(203, "The release is planned.", "The release is launched.", { documentId: 44n, structurePath: "/status", structureTitle: "Status" }));
        alignments.push(modified(204, "Retries are optional.", "Retries are required.", { documentId: 44n, structurePath: "/requirements", structureTitle: "Requirements" }));
        const long = " Detailed source wording about the operating model and customer rollout remains copied for audit verification.".repeat(4);
        for (let index = 0; index < 6; index++) alignments.push(modified(300 + index, `Old rewrite fragment ${index}.${long}`, `Rephrased rewrite fragment ${index}.${long}`, { documentId: 44n, structurePath: "/rewrite", structureTitle: "Large rewrite" }));
        for (let index = 0; index < 5; index++) alignments.push(modified(400 + index, `- Editorial source fragment ${index}.${long}`, `* Editorial source fragment ${index}.${long}`, { documentId: 44n, structurePath: "/editorial", structureTitle: "Editorial" }));

        const result = materializeDocumentChanges([{ pair: versionPair, alignments }]);
        const shuffled = materializeDocumentChanges([{ pair: versionPair, alignments: [...alignments].reverse() }]);
        const snapshot = FounderWeeklyReviewEvidenceSnapshotSchema.parse({
            schemaVersion: "founder-weekly-review-evidence/v2",
            capturedAt: "2026-02-28T00:00:00.000Z",
            reportingPeriod: { start: "2026-02-01", end: "2026-02-28" },
            workspaceTimezone: "UTC",
            items: result.items,
            sourceWarnings: [],
            documentChangeAudit: result.audit,
        });
        const envelope = buildGenerationEvidenceEnvelope(snapshot);
        const prompt = buildFounderWeeklyReviewPrompt(snapshot, envelope);

        expect(result.diagnostics).toMatchObject({ alignedChunkCount: 40, rawModifiedCount: 15, deterministicNoOpCount: 5, groupCount: 6, selectedGroupCount: 6, rawAuditCount: 15, condensedEvidenceCount: 6 });
        expect(result.analyzedGroups.map(group => group.materiality.category)).toEqual(expect.arrayContaining(["ownership_change", "deadline_change", "status_change", "requirement_change", "uncertain", "editorial_rewrite"]));
        expect(result.audit.rawChanges).toHaveLength(15);
        expect(result.items).toHaveLength(6);
        expect(result.selectedGroups.map(entry => entry.group.groupId)).toEqual(shuffled.selectedGroups.map(entry => entry.group.groupId));
        expect(result.diagnostics.rawExcerptCharacters).toBeGreaterThan(result.diagnostics.condensedPromptFacingCharacters * 1.5);
        expect(result.diagnostics.estimatedReductionRatio).toBeGreaterThan(1.5);
        expect(result.diagnostics.rawExcerptCharacters).toBe(10_484);
        expect(result.diagnostics.condensedPromptFacingCharacters).toBe(2_311);
        expect(envelope.diagnostics.serializedCharacterCount).toBe(5_466);
        expect(envelope.diagnostics.serializedCharacterCount).toBeLessThanOrEqual(14_000);
        expect(prompt).not.toContain("rawChanges");
        expect(prompt).not.toContain("documentChangeAudit");
    });
});

describe("Founder Weekly Review evidence snapshot v2", () => {
    const v1 = {
        schemaVersion: "founder-weekly-review-evidence/v1" as const,
        capturedAt: "2026-02-28T00:00:00.000Z",
        reportingPeriod: { start: "2026-02-01", end: "2026-02-28" },
        workspaceTimezone: "UTC",
        items: [],
        sourceWarnings: [],
    };

    it("parses v1 and v2 without mutating v1", () => {
        const result = materializeDocumentChanges([{ pair: pair(), alignments: [modified(1, "planned", "launched")] }]);
        const v2 = { ...v1, schemaVersion: "founder-weekly-review-evidence/v2" as const, items: result.items, documentChangeAudit: result.audit };
        expect(FounderWeeklyReviewEvidenceSnapshotSchema.parse(v1)).toEqual(v1);
        expect(FounderWeeklyReviewEvidenceSnapshotSchema.parse(v2)).toEqual(v2);
        expect(v1).not.toHaveProperty("documentChangeAudit");
        const parsedV2 = FounderWeeklyReviewEvidenceSnapshotSchema.parse(v2);
        expect(resolveDocumentChangeEvidenceAudit(parsedV2, result.items[0]!.sourceId)?.rawChanges).toHaveLength(1);
        if (parsedV2.schemaVersion !== "founder-weekly-review-evidence/v2") throw new Error("Expected v2 snapshot");
        const baseDigest = buildFounderWeeklyReviewEvidenceDigest(parsedV2);
        const provenanceChanged = structuredClone(parsedV2);
        provenanceChanged.documentChangeAudit.rawChanges[0]!.previousExcerpt = "different copied provenance";
        const materialityChanged = structuredClone(parsedV2);
        materialityChanged.documentChangeAudit.groups[0]!.category = "uncertain";
        materialityChanged.documentChangeAudit.groups[0]!.priority = 9;
        const evidenceChanged = structuredClone(parsedV2);
        evidenceChanged.items[0]!.excerpt = "different condensed evidence";
        expect(buildFounderWeeklyReviewEvidenceDigest(provenanceChanged)).not.toBe(baseDigest);
        expect(buildFounderWeeklyReviewEvidenceDigest(materialityChanged)).not.toBe(baseDigest);
        expect(buildFounderWeeklyReviewEvidenceDigest(evidenceChanged)).not.toBe(baseDigest);
        expect(buildFounderWeeklyReviewPrompt(provenanceChanged)).toBe(buildFounderWeeklyReviewPrompt(parsedV2));
    });

    it("keeps audit text out of the prompt and digests the complete snapshot", () => {
        const auditSecret = "AUDIT_ONLY_RAW_SOURCE_TEXT";
        const snapshot = FounderWeeklyReviewEvidenceSnapshotSchema.parse({
            ...v1,
            schemaVersion: "founder-weekly-review-evidence/v2",
            documentChangeAudit: {
                schemaVersion: "document-change-audit/v1",
                rawChanges: [{
                    rawChangeId: `raw_document_change:${"a".repeat(64)}`, changeType: "removed", alignmentMethod: "unmatched",
                    documentId: "1", previousVersionId: 1, currentVersionId: 2, previousChunkId: 1, currentChunkId: null,
                    previousExcerpt: auditSecret, currentExcerpt: null, previousHash: "b".repeat(64), currentHash: null,
                    previousStructurePath: "/secret", currentStructurePath: null, previousStructureTitle: "Secret", currentStructureTitle: null,
                    previousPageNumber: 1, currentPageNumber: null, previousLineStart: 1, previousLineEnd: 2, currentLineStart: null, currentLineEnd: null,
                    processingVersion: "raw-document-change/v1",
                }],
                groups: [{
                    groupId: `document_change_group:${"c".repeat(64)}`, evidenceSourceId: null, documentId: "1", previousVersionId: 1, currentVersionId: 2,
                    structurePath: "/secret", structureTitle: "Secret", splitOrdinal: 0, rawChangeIds: [`raw_document_change:${"a".repeat(64)}`],
                    category: "uncertain", priority: 9, confidence: "uncertain", signals: ["no_strong_deterministic_signal"],
                    materialityMethod: "deterministic", materialityVersion: "document-change-materiality/v1",
                }],
            },
        });
        const prompt = buildFounderWeeklyReviewPrompt(snapshot);
        const firstDigest = buildFounderWeeklyReviewEvidenceDigest(snapshot);
        const identicalDigest = buildFounderWeeklyReviewEvidenceDigest(FounderWeeklyReviewEvidenceSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot))));
        const changed = structuredClone(snapshot);
        if (changed.schemaVersion !== "founder-weekly-review-evidence/v2") throw new Error("Expected v2 snapshot");
        changed.documentChangeAudit.groups[0]!.rawChangeIds = [`raw_document_change:${"d".repeat(64)}`];

        expect(prompt).not.toContain(auditSecret);
        expect(prompt).not.toContain("documentChangeAudit");
        expect(identicalDigest).toBe(firstDigest);
        expect(buildFounderWeeklyReviewEvidenceDigest(changed)).not.toBe(firstDigest);
    });

    it("generates from v2 without a provider when prompt evidence is empty and records distinct digest metadata", async () => {
        const snapshot = FounderWeeklyReviewEvidenceSnapshotSchema.parse({
            ...v1,
            schemaVersion: "founder-weekly-review-evidence/v2",
            documentChangeAudit: { schemaVersion: "document-change-audit/v1", rawChanges: [], groups: [] },
        });
        const generate = jest.fn();
        const result = await generateFounderWeeklyReview({ evidenceSnapshot: snapshot, generate });
        expect(generate).not.toHaveBeenCalled();
        expect(result.modelMetadata.evidenceSchemaVersion).toBe("founder-weekly-review-evidence/v2");
        expect(result.modelMetadata.attributes.evidenceDigest).toBe(buildFounderWeeklyReviewEvidenceDigest(snapshot));
    });
});
