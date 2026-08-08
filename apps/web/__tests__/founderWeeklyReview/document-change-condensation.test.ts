import {
    DOCUMENT_CHANGE_GROUP_BUDGET,
    FounderWeeklyReviewEvidenceItemSchema,
    alignVersionChunks,
    buildDocumentChangeEvidence,
    buildDocumentChangeGroupEvidence,
    buildGenerationEvidenceEnvelope,
    buildRawDocumentChanges,
    condenseDocumentChanges,
    groupRawDocumentChanges,
    normalizeDocumentChangeContent,
    selectDocumentChangeGroups,
    type ChunkAlignment,
    type DocumentChangeGroup,
    type VersionChunk,
    type VersionPair,
} from "@launchstack/features/founder-weekly-review";

const pair = (documentId = 1n, previousVersionId = 1, currentVersionId = 2): VersionPair => ({
    documentId,
    documentTitle: `Document ${documentId}`,
    documentCategory: "Product",
    previousVersionId,
    previousVersionNumber: previousVersionId,
    previousCreatedAt: new Date(`2026-01-${String(Math.min(previousVersionId, 28)).padStart(2, "0")}T00:00:00.000Z`),
    currentVersionId,
    currentVersionNumber: currentVersionId,
    currentCreatedAt: new Date(`2026-02-${String(Math.min(currentVersionId, 28)).padStart(2, "0")}T00:00:00.000Z`),
    currentChangelog: null,
});

const chunk = (
    chunkId: number,
    versionId: bigint,
    content: string,
    overrides: Partial<VersionChunk> = {}
): VersionChunk => ({
    chunkId,
    versionId,
    documentId: 1n,
    content,
    contentHash: null,
    structureId: BigInt(chunkId),
    structurePath: "/overview",
    structureTitle: "Overview",
    structureOrdering: chunkId,
    pageNumber: Math.ceil(chunkId / 2),
    lineStart: chunkId * 10,
    lineEnd: chunkId * 10 + 5,
    ...overrides,
});

const modified = (
    id: number,
    before: string,
    after: string,
    overrides: Partial<VersionChunk> = {}
): ChunkAlignment => ({
    changeType: "modified",
    previousChunk: chunk(id, 1n, before, overrides),
    currentChunk: chunk(10_000 + id, 2n, after, overrides),
    alignmentMethod: "structure_path",
});

describe("deterministic document-change condensation", () => {
    it("constructs stable, distinct raw IDs and preserves provenance independent of alignment order", () => {
        const versionPair = pair();
        const alignments: ChunkAlignment[] = [
            modified(1, "before", "after"),
            { changeType: "removed", previousChunk: chunk(2, 1n, "removed", { structurePath: "/removed" }), alignmentMethod: "unmatched" },
            { changeType: "added", currentChunk: chunk(3, 2n, "added", { structurePath: "/added" }), alignmentMethod: "unmatched" },
        ];
        const first = buildRawDocumentChanges(versionPair, alignments);
        const shuffled = buildRawDocumentChanges(versionPair, [alignments[2]!, alignments[0]!, alignments[1]!]);

        expect(shuffled).toEqual(first);
        expect(new Set(first.rawChanges.map(change => change.rawChangeId)).size).toBe(3);
        expect(first.rawChanges.every(change => /^raw_document_change:[a-f0-9]{64}$/.test(change.rawChangeId))).toBe(true);
        expect(first.rawChanges.find(change => change.changeType === "modified")).toEqual(expect.objectContaining({
            previousChunk: expect.objectContaining({ chunkId: 1 }),
            currentChunk: expect.objectContaining({ chunkId: 10_001 }),
        }));
        const changedContent = buildRawDocumentChanges(versionPair, [modified(1, "before", "different after")]);
        expect(changedContent.rawChanges[0]!.rawChangeId).not.toBe(first.rawChanges.find(change => change.changeType === "modified")!.rawChangeId);
    });

    it.each([
        ["ordinary whitespace", "alpha beta", " alpha   beta "],
        ["CRLF", "alpha\nbeta", "alpha\r\nbeta"],
        ["CR", "alpha\nbeta", "alpha\rbeta"],
        ["non-breaking space", "alpha beta", "alpha\u00a0beta"],
        ["leading and trailing whitespace", "alpha", "\t alpha \n"],
        ["Unicode NFC", "Café", "Cafe\u0301"],
    ])("filters %s-only modifications", (_name, before, after) => {
        expect(normalizeDocumentChangeContent(before)).toBe(normalizeDocumentChangeContent(after));
        expect(buildRawDocumentChanges(pair(), [modified(1, before, after)])).toEqual({
            rawChanges: [],
            deterministicNoOpCount: 1,
        });
    });

    it.each([
        ["punctuation", "Launch.", "Launch!"],
        ["capitalization", "Product", "product"],
        ["number", "10 users", "100 users"],
        ["percentage", "10%", "20%"],
        ["date", "August 7", "August 8"],
        ["quarter", "Q3", "Q4"],
        ["owner", "Product owns this", "Platform owns this"],
        ["negation", "supports export", "does not support export"],
        ["modal", "may ship", "must ship"],
        ["requirement", "optional", "required"],
        ["status", "planned", "launched"],
    ])("retains a %s change", (_name, before, after) => {
        const result = buildRawDocumentChanges(pair(), [modified(1, before, after)]);
        expect(result.deterministicNoOpCount).toBe(0);
        expect(result.rawChanges).toHaveLength(1);
    });

    it("groups adjacent mixed changes within a section and never crosses known section boundaries", () => {
        const versionPair = pair();
        const alignments: ChunkAlignment[] = [
            modified(1, "old one", "new one", { structurePath: "/alpha", structureTitle: "Alpha" }),
            { changeType: "removed", previousChunk: chunk(2, 1n, "old two", { structurePath: "/alpha", structureTitle: "Alpha" }), alignmentMethod: "unmatched" },
            { changeType: "added", currentChunk: chunk(3, 2n, "new two", { structurePath: "/alpha", structureTitle: "Alpha" }), alignmentMethod: "unmatched" },
            modified(4, "old beta", "new beta", { structurePath: "/beta", structureTitle: "Beta", pageNumber: 2 }),
        ];
        const raw = buildRawDocumentChanges(versionPair, alignments).rawChanges;
        const grouped = groupRawDocumentChanges(versionPair, raw);

        expect(grouped.groups).toHaveLength(2);
        expect(grouped.groups.map(group => group.rawChanges.length).sort()).toEqual([1, 3]);
        expect(grouped.groups.find(group => group.structurePath === "/alpha")?.rawChanges.map(change => change.changeType).sort()).toEqual(["added", "modified", "removed"]);
    });

    it("keeps distinct known titles separate when paths are unavailable", () => {
        const versionPair = pair();
        const raw = buildRawDocumentChanges(versionPair, [
            modified(1, "old alpha", "new alpha", { structurePath: null, structureTitle: "Alpha", pageNumber: 1 }),
            modified(2, "old beta", "new beta", { structurePath: null, structureTitle: "Beta", pageNumber: 1 }),
        ]).rawChanges;
        expect(groupRawDocumentChanges(versionPair, raw).groups).toHaveLength(2);
    });

    it("does not merge conflicting known paths solely because their titles match", () => {
        const versionPair = pair();
        const raw = buildRawDocumentChanges(versionPair, [
            modified(1, "old one", "new one", { structurePath: "/one", structureTitle: "Overview", pageNumber: 1 }),
            modified(2, "old two", "new two", { structurePath: "/two", structureTitle: "Overview", pageNumber: 1 }),
        ]).rawChanges;
        expect(groupRawDocumentChanges(versionPair, raw).groups).toHaveLength(2);
    });

    it("groups renamed paths through connected aligned chunks and supports one-to-many and many-to-one boundaries", () => {
        const versionPair = pair();
        const renamed: ChunkAlignment[] = [1, 2].map(id => ({
            changeType: "modified" as const,
            previousChunk: chunk(id, 1n, `old ${id}`, { structurePath: "/old", structureTitle: "Plan" }),
            currentChunk: chunk(100 + id, 2n, `new ${id}`, { structurePath: "/new", structureTitle: "Plan" }),
            alignmentMethod: "section_title" as const,
        }));
        const oneToMany: ChunkAlignment[] = [
            modified(3, "one", "part one", { structurePath: "/split", structureTitle: "Split" }),
            { changeType: "added", currentChunk: chunk(104, 2n, "part two", { structurePath: "/split", structureTitle: "Split" }), alignmentMethod: "unmatched" },
        ];
        const manyToOne: ChunkAlignment[] = [
            modified(5, "part one", "merged", { structurePath: "/merge", structureTitle: "Merge" }),
            { changeType: "removed", previousChunk: chunk(6, 1n, "part two", { structurePath: "/merge", structureTitle: "Merge" }), alignmentMethod: "unmatched" },
        ];
        const groups = groupRawDocumentChanges(versionPair, buildRawDocumentChanges(versionPair, [...renamed, ...oneToMany, ...manyToOne]).rawChanges).groups;

        expect(groups).toHaveLength(3);
        expect(groups.map(group => group.rawChanges.length).sort()).toEqual([2, 2, 2]);
    });

    it("keeps exact reordered content unchanged before grouping", () => {
        const hashA = "a".repeat(64); const hashB = "b".repeat(64);
        const previous = [
            chunk(1, 1n, "Alpha exact", { contentHash: hashA, structurePath: "/a" }),
            chunk(2, 1n, "Beta exact", { contentHash: hashB, structurePath: "/b" }),
        ];
        const current = [
            chunk(3, 2n, "Beta exact", { contentHash: hashB, structurePath: "/moved-b" }),
            chunk(4, 2n, "Alpha exact", { contentHash: hashA, structurePath: "/moved-a" }),
        ];
        const alignments = alignVersionChunks(previous, current);
        const condensed = condenseDocumentChanges([{ pair: pair(), alignments }]);
        expect(alignments.every(item => item.changeType === "unchanged")).toBe(true);
        expect(condensed.rawChanges).toHaveLength(0);
        expect(condensed.groups).toHaveLength(0);
    });

    it("produces identical groups and IDs for shuffled raw input", () => {
        const versionPair = pair();
        const raw = buildRawDocumentChanges(versionPair, [
            modified(1, "a", "aa", { structurePath: "/a", structureTitle: "A" }),
            modified(2, "b", "bb", { structurePath: "/a", structureTitle: "A" }),
            modified(3, "c", "cc", { structurePath: "/b", structureTitle: "B" }),
        ]).rawChanges;
        const first = groupRawDocumentChanges(versionPair, raw);
        const shuffled = groupRawDocumentChanges(versionPair, [raw[2]!, raw[0]!, raw[1]!]);
        expect(shuffled).toEqual(first);
        expect(first.groups.every(group => /^document_change_group:[a-f0-9]{64}$/.test(group.groupId))).toBe(true);
        const changedSupport = buildRawDocumentChanges(versionPair, [
            modified(1, "a", "different", { structurePath: "/a", structureTitle: "A" }),
            modified(2, "b", "bb", { structurePath: "/a", structureTitle: "A" }),
        ]).rawChanges;
        expect(groupRawDocumentChanges(versionPair, changedSupport).groups[0]!.groupId).not.toBe(first.groups[0]!.groupId);
    });

    it("keeps 16 records together and splits 17 into stable bounded windows with one warning", () => {
        const versionPair = pair();
        const sixteen = buildRawDocumentChanges(versionPair, Array.from({ length: 16 }, (_, index) =>
            modified(index + 1, `before ${index}`, `after ${index}`, { structurePath: "/large", structureTitle: "Large" }))).rawChanges;
        expect(groupRawDocumentChanges(versionPair, sixteen).groups).toHaveLength(1);

        const seventeen = buildRawDocumentChanges(versionPair, [
            ...Array.from({ length: 16 }, (_, index) => modified(index + 1, `before ${index}`, `after ${index}`, { structurePath: "/large", structureTitle: "Large" })),
            modified(17, "before 17", "after 17", { structurePath: "/large", structureTitle: "Large" }),
        ]).rawChanges;
        const first = groupRawDocumentChanges(versionPair, seventeen);
        const shuffled = groupRawDocumentChanges(versionPair, [...seventeen].reverse());
        expect(first.groups.map(group => group.rawChanges.length)).toEqual([16, 1]);
        expect(first.groups.map(group => group.splitOrdinal)).toEqual([0, 1]);
        expect(first.groups.every(group => group.rawChanges.length <= DOCUMENT_CHANGE_GROUP_BUDGET.rawChangesPerGroup)).toBe(true);
        expect(first.warnings).toEqual([expect.objectContaining({ code: "materiality_group_too_large" })]);
        expect(shuffled).toEqual(first);
    });

    it("enforces pair, document, and review limits with deterministic round-robin diversity", () => {
        const inputs = [1n, 2n, 3n, 4n].map(documentId => {
            const versionPair = pair(documentId);
            return {
                pair: versionPair,
                alignments: Array.from({ length: 12 }, (_, index) => modified(
                    Number(documentId) * 100 + index,
                    `before ${documentId}-${index}`,
                    `after ${documentId}-${index}`,
                    { documentId, structurePath: `/section-${index}`, structureTitle: `Section ${index}` }
                )),
            };
        });
        const first = condenseDocumentChanges(inputs);
        const shuffled = condenseDocumentChanges([...inputs].reverse().map(input => ({ ...input, alignments: [...input.alignments].reverse() })));
        const byDocument = new Map<string, number>();
        const byPair = new Map<string, number>();
        for (const group of first.selectedGroups) {
            const documentId = group.documentId.toString();
            const versionPair = `${documentId}:${group.previousVersionId}:${group.currentVersionId}`;
            byDocument.set(documentId, (byDocument.get(documentId) ?? 0) + 1);
            byPair.set(versionPair, (byPair.get(versionPair) ?? 0) + 1);
        }
        expect(first.selectedGroups).toHaveLength(24);
        expect([...byDocument.values()].every(count => count <= 8)).toBe(true);
        expect([...byPair.values()].every(count => count <= 8)).toBe(true);
        expect([...byDocument.keys()]).toEqual(["1", "2", "3", "4"]);
        expect(first.warnings).toContainEqual(expect.objectContaining({ code: "document_change_budget_truncated" }));
        expect(shuffled.selectedGroups.map(group => group.groupId)).toEqual(first.selectedGroups.map(group => group.groupId));
    });

    it("round-robins version pairs within a document", () => {
        const inputs = [pair(1n, 1, 2), pair(1n, 2, 3)].map((versionPair, pairIndex) => ({
            pair: versionPair,
            alignments: Array.from({ length: 6 }, (_, index) => modified(
                pairIndex * 100 + index + 1,
                `before ${pairIndex}-${index}`,
                `after ${pairIndex}-${index}`,
                { structurePath: `/pair-${pairIndex}-section-${index}`, structureTitle: `Pair ${pairIndex} Section ${index}` }
            )),
        }));
        const result = condenseDocumentChanges(inputs);
        expect(result.selectedGroups).toHaveLength(8);
        expect(result.selectedGroups.filter(group => group.currentVersionId === 2)).toHaveLength(4);
        expect(result.selectedGroups.filter(group => group.currentVersionId === 3)).toHaveLength(4);
    });

    it("keeps the existing evidence contract and source ID for a one-change group", () => {
        const evidence = buildDocumentChangeEvidence(pair(), [modified(7, "Before", "After")]);
        expect(evidence).toEqual([expect.objectContaining({
            sourceType: "document_change",
            sourceId: "document_change:doc:1:v1:v2:chunk:7:10007",
            excerpt: "Section modified. Before: Before After: After",
        })]);
        expect(FounderWeeklyReviewEvidenceItemSchema.safeParse(evidence[0]).success).toBe(true);
    });

    it("reports the actual deterministic no-op count used by the collector", () => {
        const result = condenseDocumentChanges([{ pair: pair(), alignments: [modified(7, "  same\r\nvalue\u00a0 ", "same\nvalue ")] }]);
        expect(result.diagnostics.deterministicNoOpCount).toBe(1);
        expect(result.rawChanges).toHaveLength(0);
        expect(result.selectedGroups).toHaveLength(0);
    });

    it("condenses a deterministic 20-page, 40-chunk enterprise fixture before the prompt envelope", () => {
        const versionPair = pair(44n);
        const alignments: ChunkAlignment[] = [];
        for (let index = 0; index < 20; index++) {
            const exact = `unchanged section ${index}`;
            alignments.push({
                changeType: "unchanged",
                previousChunk: chunk(index + 1, 1n, exact, { documentId: 44n, pageNumber: index + 1, structurePath: `/unchanged-${index}`, structureTitle: `Unchanged ${index}` }),
                currentChunk: chunk(1_001 + index, 2n, exact, { documentId: 44n, pageNumber: index + 1, structurePath: `/unchanged-${index}`, structureTitle: `Unchanged ${index}` }),
                alignmentMethod: "content_hash",
            });
        }
        for (let index = 0; index < 5; index++) alignments.push(modified(100 + index, `wrapped line ${index}`, `  wrapped\r\n line\u00a0${index}  `, { documentId: 44n, pageNumber: index + 1, structurePath: `/noop-${index}`, structureTitle: `No-op ${index}` }));
        for (let index = 0; index < 4; index++) alignments.push(modified(200 + index, `planned metric ${index}`, `launched metric ${index + 1}`, { documentId: 44n, pageNumber: 6 + index, structurePath: `/material-${index}`, structureTitle: `Material ${index}` }));
        for (let index = 0; index < 6; index++) alignments.push(modified(300 + index, `old rewritten ${index}`, `new rewritten ${index}`, { documentId: 44n, pageNumber: 10 + Math.floor(index / 2), structurePath: "/rewritten", structureTitle: "Rewritten section" }));
        for (let index = 0; index < 5; index++) alignments.push(modified(400 + index, `editorial wording ${index}`, `rephrased wording ${index}`, { documentId: 44n, pageNumber: 15 + index, structurePath: "/editorial", structureTitle: "Editorial section" }));

        const first = condenseDocumentChanges([{ pair: versionPair, alignments }]);
        const shuffled = condenseDocumentChanges([{ pair: versionPair, alignments: [...alignments].reverse() }]);
        const evidence = first.selectedGroups.map(group => buildDocumentChangeGroupEvidence(versionPair, group));
        const snapshot = {
            schemaVersion: "founder-weekly-review-evidence/v1" as const,
            capturedAt: "2026-02-28T00:00:00.000Z",
            reportingPeriod: { start: "2026-02-01", end: "2026-02-28" },
            workspaceTimezone: "UTC",
            items: evidence,
            sourceWarnings: [],
        };
        const envelope = buildGenerationEvidenceEnvelope(snapshot);

        expect(alignments).toHaveLength(40);
        expect(first.diagnostics).toEqual(expect.objectContaining({
            alignedChunkCount: 40,
            rawModifiedCount: 15,
            deterministicNoOpCount: 5,
            groupCount: 6,
            selectedGroupCount: 6,
            truncatedGroupCount: 0,
        }));
        expect(first.selectedGroups.every(group => group.rawChanges.length <= 16)).toBe(true);
        expect(first.selectedGroups.map(group => group.groupId)).toEqual(shuffled.selectedGroups.map(group => group.groupId));
        expect(evidence).toHaveLength(6);
        expect(envelope.diagnostics.selectedBySourceType.document_change).toBe(6);
        expect(envelope.diagnostics.serializedCharacterCount).toBeLessThanOrEqual(14_000);
        expect(first.warnings).toEqual([]);
    });
});
