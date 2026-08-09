import {
    FOUNDER_WEEKLY_REVIEW_EVIDENCE_ENVELOPE_VERSION,
    FOUNDER_WEEKLY_REVIEW_GENERATION_EVIDENCE_BUDGET,
    FounderWeeklyReviewGenerationEvidenceBudgetError,
    assertGenerationEvidenceEnvelopeWithinBudget,
    buildFounderWeeklyReviewPrompt,
    buildFounderWeeklyReviewPromptEvidenceItem,
    buildGenerationEvidenceEnvelope,
    type FounderWeeklyReviewEvidenceItem,
    type FounderWeeklyReviewEvidenceSnapshot,
    type GenerationEvidenceEnvelope,
} from "@launchstack/features/founder-weekly-review";

function snapshot(items: FounderWeeklyReviewEvidenceItem[]): FounderWeeklyReviewEvidenceSnapshot {
    return {
        schemaVersion: "founder-weekly-review-evidence/v1",
        capturedAt: "2026-07-18T10:00:00.000Z",
        reportingPeriod: { start: "2026-07-07", end: "2026-07-13" },
        workspaceTimezone: "UTC",
        items,
        sourceWarnings: [],
    };
}

function item(
    sourceType: FounderWeeklyReviewEvidenceItem["sourceType"],
    sourceId: string,
    excerpt = "x".repeat(200),
    metadata: FounderWeeklyReviewEvidenceItem["metadata"] = {},
    sourceTimestamp = "2026-07-10T10:00:00.000Z"
): FounderWeeklyReviewEvidenceItem {
    return {
        sourceType,
        sourceId,
        title: `${sourceType} title`,
        sourceTimestamp,
        excerpt,
        metadata,
    };
}

function documentChanges(
    count: number,
    documentCount: number,
    excerpt = "x".repeat(200)
): FounderWeeklyReviewEvidenceItem[] {
    return Array.from({ length: count }, (_, index) => {
        const documentId = String((index % documentCount) + 1);
        const sequence = Math.floor(index / documentCount) + 1;
        return item(
            "document_change",
            `document_change:doc:${documentId}:v1:v2:chunk:${sequence}:${sequence}`,
            excerpt,
            {
                documentId,
                previousVersionId: 1,
                currentVersionId: 2,
                previousVersionNumber: 1,
                currentVersionNumber: 2,
                changeType: "modified",
                alignmentMethod: "structure_path",
                structurePath: `/section/${sequence}`,
                previousChunkId: sequence,
                currentChunkId: sequence,
                previousContentHash: "a".repeat(64),
                currentContentHash: "b".repeat(64),
            },
            `2026-07-${String((sequence % 7) + 7).padStart(2, "0")}T10:00:00.000Z`
        );
    });
}

describe("Founder Weekly Review generation evidence envelope", () => {
    it("bounds 250 document changes with round-robin document diversity without mutating the snapshot", () => {
        const evidenceSnapshot = snapshot(documentChanges(250, 3));
        const original = JSON.stringify(evidenceSnapshot);
        const first = buildGenerationEvidenceEnvelope(evidenceSnapshot);
        const second = buildGenerationEvidenceEnvelope(evidenceSnapshot);
        const changes = first.items.filter(entry => entry.sourceType === "document_change");
        const perDocument = new Map<string, number>();
        for (const change of changes) {
            const documentId = /^document_change:doc:([^:]+)/.exec(change.sourceId)![1]!;
            perDocument.set(documentId, (perDocument.get(documentId) ?? 0) + 1);
        }

        expect(changes).toHaveLength(24);
        expect(Math.max(...perDocument.values())).toBe(8);
        expect(JSON.stringify(changes).length).toBeLessThanOrEqual(14_000);
        expect(first.items.map(entry => entry.sourceId)).toEqual(
            second.items.map(entry => entry.sourceId)
        );
        expect(first.diagnostics).toEqual(second.diagnostics);
        expect(evidenceSnapshot.items).toHaveLength(250);
        expect(JSON.stringify(evidenceSnapshot)).toBe(original);
    });

    it("reserves Founder Context, customer feedback, and workspace evidence before bounded document changes", () => {
        const items = [
            ...documentChanges(250, 3, "d".repeat(300)),
            ...Array.from({ length: 250 }, (_, index) =>
                item("customer_feedback", `customer_feedback:${index}`, "c".repeat(500), {
                    pageNumber: index + 1,
                })
            ),
            ...Array.from({ length: 8 }, (_, index) =>
                item(
                    "workspace_document",
                    `workspace_document:${index}`,
                    "w".repeat(500),
                    {
                        similarityScore: 1 - index / 100,
                        retrievalReason: "founder_context_relevance",
                    },
                    ""
                )
            ),
            item(
                "founder_context",
                "founder_context:entry:test",
                "Founder direction",
                { provenance: "request_time_founder_input" },
                ""
            ),
        ];
        // This intentionally models the pre-snapshot aggregate (509 items)
        // that the 500-item snapshot cap subsequently trims.
        const evidenceSnapshot = snapshot(items) as FounderWeeklyReviewEvidenceSnapshot;
        const envelope = buildGenerationEvidenceEnvelope(evidenceSnapshot);

        expect(envelope.diagnostics.selectedBySourceType.founder_context).toBe(1);
        expect(envelope.diagnostics.selectedBySourceType.customer_feedback).toBeGreaterThan(0);
        expect(envelope.diagnostics.selectedBySourceType.workspace_document).toBe(8);
        expect(envelope.diagnostics.selectedBySourceType.document_change).toBeLessThanOrEqual(24);
        expect(envelope.diagnostics.selectedBySourceType.customer_feedback).toBeGreaterThan(
            envelope.diagnostics.selectedBySourceType.document_change
        );
        expect(envelope.diagnostics.serializedCharacterCount).toBeLessThanOrEqual(72_000);
        expect(envelope.diagnostics.estimatedTokenCount).toBeLessThanOrEqual(18_000);
        expect(envelope.diagnostics.truncated).toBe(true);
    });

    it("is input-order independent and produces byte-identical prompts", () => {
        const items = [
            ...documentChanges(60, 4),
            item("customer_feedback", "feedback-1", "Customer signal"),
            item(
                "workspace_document",
                "workspace-1",
                "Workspace context",
                { similarityScore: 0.9 },
                ""
            ),
            item("founder_context", "context-1", "Founder context", {}, ""),
        ];
        const shuffled = [...items].sort((a, b) => b.sourceId.localeCompare(a.sourceId));
        const first = buildGenerationEvidenceEnvelope(snapshot(items));
        const second = buildGenerationEvidenceEnvelope(snapshot(shuffled));

        expect(first.items.map(entry => entry.sourceId)).toEqual(
            second.items.map(entry => entry.sourceId)
        );
        expect(buildFounderWeeklyReviewPrompt(snapshot(items))).toBe(
            buildFounderWeeklyReviewPrompt(snapshot(shuffled))
        );
    });

    it("allowlists prompt metadata while retaining complete immutable snapshot metadata and source IDs", () => {
        const source = item(
            "document_change",
            "document_change:doc:7:v1:v2:chunk:1:2",
            "Before and after",
            {
                documentId: "7",
                previousChunkId: 1,
                currentChunkId: 2,
                previousContentHash: "a".repeat(64),
                currentContentHash: "b".repeat(64),
                previousVersionNumber: 1,
                currentVersionNumber: 2,
                changeType: "modified",
                alignmentMethod: "structure_path",
                structurePath: "/plan",
                userChangelog: "Updated plan",
                providerPayload: "must-not-leak",
                credential: "must-not-leak",
            }
        );
        const evidenceSnapshot = snapshot([source]);
        const prompt = JSON.parse(buildFounderWeeklyReviewPrompt(evidenceSnapshot));
        const promptItem = prompt.evidence[0];

        expect(prompt.evidenceEnvelopeVersion).toBe(
            FOUNDER_WEEKLY_REVIEW_EVIDENCE_ENVELOPE_VERSION
        );
        expect(prompt.evidenceEnvelopeBudget.totalSerializedCharacters).toBe(72_000);
        expect(promptItem.sourceId).toBe(source.sourceId);
        expect(promptItem.metadata).toEqual({
            alignmentMethod: "structure_path",
            changeType: "modified",
            currentVersionNumber: 2,
            previousVersionNumber: 1,
            structurePath: "/plan",
            userChangelog: "Updated plan",
        });
        expect(promptItem).not.toHaveProperty("canonicalUrl");
        expect(promptItem).not.toHaveProperty("workspaceDeepLink");
        expect(evidenceSnapshot.items[0]!.metadata).toHaveProperty("previousContentHash");
        expect(evidenceSnapshot.items[0]!.metadata).toHaveProperty("providerPayload");
    });

    it("includes candidates atomically until the document-change character boundary", () => {
        const evidenceSnapshot = snapshot(documentChanges(8, 1, "x".repeat(3_000)));
        const envelope = buildGenerationEvidenceEnvelope(evidenceSnapshot);
        const selected = envelope.items.filter(entry => entry.sourceType === "document_change");
        const excluded = evidenceSnapshot.items.find(
            entry => !selected.some(candidate => candidate.sourceId === entry.sourceId)
        );

        expect(selected.length).toBeGreaterThan(0);
        expect(excluded).toBeDefined();
        expect(JSON.stringify(selected).length).toBeLessThanOrEqual(
            FOUNDER_WEEKLY_REVIEW_GENERATION_EVIDENCE_BUDGET.documentChangeSerializedCharacters
        );
        expect(
            JSON.stringify([...selected, buildFounderWeeklyReviewPromptEvidenceItem(excluded!)])
                .length
        ).toBeGreaterThan(
            FOUNDER_WEEKLY_REVIEW_GENERATION_EVIDENCE_BUDGET.documentChangeSerializedCharacters
        );
        expect(envelope.diagnostics.truncated).toBe(true);
    });

    it("rejects a corrupted over-budget envelope locally", () => {
        const valid = buildGenerationEvidenceEnvelope(snapshot([item("manual_note", "note-1")]));
        const corrupted: GenerationEvidenceEnvelope = {
            ...valid,
            items: Array.from({ length: 20 }, (_, index) => ({
                ...valid.items[0]!,
                sourceId: `note-${index}`,
                excerpt: "x".repeat(4_000),
            })),
        };

        expect(() => assertGenerationEvidenceEnvelopeWithinBudget(corrupted)).toThrow(
            FounderWeeklyReviewGenerationEvidenceBudgetError
        );
        expect(() => buildFounderWeeklyReviewPrompt(snapshot([]), corrupted)).toThrow(
            expect.objectContaining({ code: "generation_evidence_budget_exceeded" })
        );
    });

    it("publishes a versioned envelope and safe aggregate diagnostics only", () => {
        const envelope = buildGenerationEvidenceEnvelope(snapshot([item("manual_note", "note-1")]));
        expect(envelope.version).toBe(FOUNDER_WEEKLY_REVIEW_EVIDENCE_ENVELOPE_VERSION);
        expect(envelope.diagnostics).toEqual(
            expect.objectContaining({
                originalItemCount: 1,
                selectedItemCount: 1,
                excludedItemCount: 0,
                serializedCharacterCount: JSON.stringify(envelope.items).length,
                estimatedTokenCount: Math.ceil(JSON.stringify(envelope.items).length / 4),
                truncated: false,
            })
        );
        expect(JSON.stringify(envelope.diagnostics)).not.toContain("manual_note title");
        expect(JSON.stringify(envelope.diagnostics)).not.toContain("x".repeat(20));
    });
});
