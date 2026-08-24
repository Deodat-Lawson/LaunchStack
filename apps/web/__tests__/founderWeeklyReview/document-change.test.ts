import {
    alignVersionChunks,
    buildDocumentChangeEvidence,
    selectVersionPairsForReportingPeriod,
    FounderWeeklyReviewEvidenceService,
    FounderWeeklyReviewEvidenceItemSchema,
    type DocumentVersionForComparison,
    type VersionChunk,
} from "@launchstack/features/founder-weekly-review";

const version = (
    documentId: bigint,
    versionId: number,
    versionNumber: number,
    createdAt: string
): DocumentVersionForComparison => ({
    documentId,
    documentTitle: `Document ${documentId}`,
    documentCategory: "Product",
    versionId,
    versionNumber,
    createdAt: new Date(createdAt),
    changelog: versionId === 2 ? "Founder supplied note" : null,
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
    structureId: 1n,
    structurePath: "/1",
    structureTitle: "Overview",
    structureOrdering: 1,
    pageNumber: 1,
    lineStart: 1,
    lineEnd: 2,
    ...overrides,
});

describe("Week 3 document change domain logic", () => {
    it("forms an adjacent chain including the predecessor before the period", () => {
        const pairs = selectVersionPairsForReportingPeriod(
            [
                version(1n, 1, 1, "2026-01-01T00:00:00.000Z"),
                version(1n, 3, 3, "2026-02-03T00:00:00.000Z"),
                version(2n, 4, 1, "2026-02-02T00:00:00.000Z"),
                version(1n, 2, 2, "2026-02-02T00:00:00.000Z"),
            ],
            new Date("2026-02-01T00:00:00.000Z"),
            new Date("2026-02-10T00:00:00.000Z")
        );
        expect(
            pairs.map(pair => [pair.documentId, pair.previousVersionId, pair.currentVersionId])
        ).toEqual([
            [1n, 1, 2],
            [1n, 2, 3],
        ]);
    });

    it("does not invent a predecessor for a first-ever in-period version and resolves timestamp ties deterministically", () => {
        const pairs = selectVersionPairsForReportingPeriod(
            [
                version(1n, 2, 2, "2026-02-02T00:00:00.000Z"),
                version(1n, 1, 1, "2026-02-02T00:00:00.000Z"),
                version(2n, 3, 1, "2026-02-02T00:00:00.000Z"),
            ],
            new Date("2026-02-01T00:00:00.000Z"),
            new Date("2026-02-03T00:00:00.000Z")
        );
        expect(pairs.map(pair => [pair.previousVersionId, pair.currentVersionId])).toEqual([
            [1, 2],
        ]);
    });

    it("aligns once, classifies changes, and leaves exact hash matches unchanged", () => {
        const hash = "a".repeat(64);
        const prior = [
            chunk(1, 1n, "same", { contentHash: hash, structurePath: "/x" }),
            chunk(2, 1n, "old", { structurePath: "/y" }),
            chunk(3, 1n, "removed", { structurePath: "/z", structureTitle: "Old only" }),
        ];
        const current = [
            chunk(4, 2n, "same", { contentHash: hash, structurePath: "/other" }),
            chunk(5, 2n, "new", { structurePath: "/y" }),
            chunk(6, 2n, "added", { structurePath: "/new", structureTitle: "New only" }),
        ];
        const alignments = alignVersionChunks(prior, current);
        expect(alignments.map(item => [item.changeType, item.alignmentMethod])).toEqual([
            ["added", "unmatched"],
            ["unchanged", "content_hash"],
            ["modified", "structure_path"],
            ["removed", "unmatched"],
        ]);
        expect(
            new Set(
                alignments.flatMap(item =>
                    [item.previousChunk?.chunkId, item.currentChunk?.chunkId].filter(Boolean)
                )
            ).size
        ).toBe(6);
    });

    it("does not trust malformed or contradictory matching hashes", () => {
        const alignments = alignVersionChunks(
            [chunk(1, 1n, "before", { contentHash: "bad", structurePath: "/same" })],
            [chunk(2, 2n, "after", { contentHash: "bad", structurePath: "/same" })]
        );
        expect(alignments).toEqual([
            expect.objectContaining({ changeType: "modified", alignmentMethod: "structure_path" }),
        ]);
    });

    it("keeps maximum-size identifiers JSON-safe and within the evidence contract", () => {
        const pair = {
            documentId: 99999999999999999999n,
            documentTitle: "D",
            documentCategory: null,
            previousVersionId: 2147483646,
            previousVersionNumber: 2147483646,
            previousCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
            currentVersionId: 2147483647,
            currentVersionNumber: 2147483647,
            currentCreatedAt: new Date("2026-02-02T00:00:00.000Z"),
            currentChangelog: "x",
        };
        const item = buildDocumentChangeEvidence(pair, [
            {
                changeType: "added",
                currentChunk: chunk(2147483647, 2147483647n, "content"),
                alignmentMethod: "unmatched",
            },
        ])[0]!;
        expect(item.sourceId.length).toBeLessThanOrEqual(256);
        expect(() => JSON.stringify(item)).not.toThrow();
        expect(FounderWeeklyReviewEvidenceItemSchema.safeParse(item).success).toBe(true);
    });

    it("creates stable computed evidence and keeps changelog separate", () => {
        const pair = selectVersionPairsForReportingPeriod(
            [
                version(1n, 1, 1, "2026-01-01T00:00:00.000Z"),
                version(1n, 2, 2, "2026-02-02T00:00:00.000Z"),
            ],
            new Date("2026-02-01T00:00:00.000Z"),
            new Date("2026-02-03T00:00:00.000Z")
        )[0]!;
        const evidence = buildDocumentChangeEvidence(
            pair,
            alignVersionChunks(
                [chunk(10, 1n, "Before", { structurePath: "/plan" })],
                [chunk(20, 2n, "After", { structurePath: "/plan" })]
            )
        );
        expect(evidence).toEqual(
            buildDocumentChangeEvidence(
                pair,
                alignVersionChunks(
                    [chunk(10, 1n, "Before", { structurePath: "/plan" })],
                    [chunk(20, 2n, "After", { structurePath: "/plan" })]
                )
            )
        );
        expect(evidence).toEqual([
            expect.objectContaining({
                sourceId: "document_change:doc:1:v1:v2:chunk:10:20",
                excerpt: expect.stringContaining("Before: Before After: After"),
                metadata: expect.objectContaining({
                    changeType: "modified",
                    userChangelog: "Founder supplied note",
                    previousVersionId: 1,
                    currentVersionId: 2,
                }),
            }),
        ]);
    });

    it("uses bounded deterministic text similarity only after structural strategies fail", () => {
        const alignments = alignVersionChunks(
            [
                chunk(1, 1n, "reliable export retry job", {
                    structurePath: "/old",
                    structureTitle: "Old",
                }),
            ],
            [
                chunk(2, 2n, "export retry job is now reliable", {
                    structurePath: "/new",
                    structureTitle: "New",
                }),
            ]
        );
        expect(alignments).toEqual([
            expect.objectContaining({ changeType: "modified", alignmentMethod: "text_similarity" }),
        ]);
    });

    it("does not use text similarity to pair short generic fragments", () => {
        const alignments = alignVersionChunks(
            [chunk(1, 1n, "status update", { structurePath: "/old", structureTitle: "Old" })],
            [chunk(2, 2n, "status update", { structurePath: "/new", structureTitle: "New" })]
        );
        expect(alignments.map(item => item.changeType)).toEqual(["added", "removed"]);
    });

    it("collects one computed change for the controlled v1-to-v2 case", async () => {
        const versions = [
            version(1n, 1, 1, "2026-01-01T00:00:00.000Z"),
            version(1n, 2, 2, "2026-02-02T00:00:00.000Z"),
        ];
        const store = {
            listVersionsForReportingPeriod: jest.fn().mockResolvedValue(versions),
            getDocumentChunksForVersions: jest.fn().mockResolvedValue(
                new Map([
                    [
                        "1:1",
                        {
                            state: "complete",
                            chunks: [chunk(10, 1n, "Before", { structurePath: "/plan" })],
                            warnings: [],
                        },
                    ],
                    [
                        "1:2",
                        {
                            state: "complete",
                            chunks: [chunk(20, 2n, "After", { structurePath: "/plan" })],
                            warnings: [],
                        },
                    ],
                ])
            ),
        };
        const service = new FounderWeeklyReviewEvidenceService({} as never, undefined, {
            kind: "computed",
            store,
        });
        await expect(
            service.collectDocumentChangeEvidence(
                1n,
                new Date("2026-02-01T00:00:00.000Z"),
                new Date("2026-02-03T00:00:00.000Z")
            )
        ).resolves.toEqual([
            expect.objectContaining({
                sourceId: expect.stringMatching(/^document_change:group:/),
                sourceTimestamp: "2026-02-02T00:00:00.000Z",
                metadata: expect.objectContaining({
                    previousVersionId: 1,
                    currentVersionId: 2,
                    category: "uncertain",
                    materialityMethod: "deterministic",
                    rawChangeCount: 1,
                }),
            }),
        ]);
    });
});
