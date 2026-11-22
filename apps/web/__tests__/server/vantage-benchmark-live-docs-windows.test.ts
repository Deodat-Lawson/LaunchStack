import {
    fitLiveDocumentsWindows,
    archivedChosenDocuments,
    projectSavedPrimary,
    primaryReferences,
    type SavedPrimary,
} from "../../scripts/vantage-benchmark-live-docs-windows-core";
import { fitTopicEvidence } from "~/server/vantage/weekly-review-topic-freeze";
import { canonicalTextHash } from "@launchstack/store/document-digests";
import { compileScopedEvidence } from "@launchstack/pipelines/vantage/scoped-evidence";
import type { TopicSeed } from "~/server/vantage/weekly-review-topic-types";
import type { createScopedSourceReader } from "~/server/vantage/weekly-review-scoped-selection";

async function fixture() {
    const date = "2026-11-15T00:00:00.000Z";
    const fixed = {
        kind: "document" as const,
        id: "1",
        ref: "doc:1@1",
        version: "1",
        hash: canonicalTextHash("Company architecture"),
        purpose: "company-architecture" as const,
        audience: "company" as const,
        text: "Company architecture",
        title: "Architecture",
    };
    const texts = [
        "prefix ".repeat(1000) + " launch critical decision " + " tail".repeat(1000),
        "other ".repeat(500) + " launch backlog " + " tail".repeat(2000),
        "unrelated notice ".repeat(80),
    ];
    const documents = texts.map((text, index) => ({
        ref: `doc:${index + 2}@${index + 2}`,
        id: String(index + 2),
        version: String(index + 2),
        versionDate: date,
        hash: canonicalTextHash(text),
        audience: "company" as const,
        purpose: "retrieved" as const,
        reason: "question" as const,
        text,
        title: "Source " + index,
        category: "Product",
    }));
    const seed: TopicSeed = {
        context: {
            actor: { companyId: "1", userId: "owner" },
            week: "2026-11-09",
            sources: [fixed],
            role: "owner",
            preferenceVersion: 1,
            authorityEpoch: "1",
            mandatoryCoverage: { required: 1, included: 1 },
        },
        documents,
        manifest: {
            week: "2026-11-09",
            cutoff: date,
            asOf: date,
            epoch: "1",
            expectedActiveId: null,
            configuration: { provider: "configured", scoped: false },
            revisions: { policy: 1, preference: 1, role: null },
            topics: [
                {
                    id: "topic",
                    revision: 1,
                    title: "Launch",
                    openQuestions: ["What is the launch decision?"],
                    keywords: ["launch"],
                    decisionChangers: [],
                    people: [],
                    metrics: [],
                    status: "active",
                    watches: [],
                },
            ],
            fixed: [fixed],
            fixedDependencies: [fixed],
            offered: documents,
            lane: [documents[2]!.ref],
            carryover: "unavailable",
        },
    };
    const read: ReturnType<typeof createScopedSourceReader> = async (
        id,
        purpose,
        cutoff,
        scope,
        revision
    ) => {
        const document = documents.find(document => document.id === id)!;
        const request = {
            actorId: "owner",
            companyId: "1",
            documentId: id,
            version: scope.version,
            asOf: cutoff,
            expectedParentHash: scope.expectedParentHash,
            selectedUnitIds: scope.requiredUnits.map(unit => unit.id),
        };
        const prepared = compileScopedEvidence(
            request,
            {
                companyId: "1",
                documentId: id,
                version: scope.version,
                versionDate: date,
                availableAt: date,
                title: document.title,
                purpose,
                chunks: [{ id: "chunk-" + id, ordinal: 0, text: document.text }],
                originalCompleteness: "unknown",
            },
            {
                actorId: "owner",
                companyId: "1",
                documentId: id,
                version: scope.version,
                authorized: true,
                purpose,
                audience: "company",
                companyReadable: true,
                aclRevision: "1",
                authorityRevision: revision,
                finiteScope: {
                    qualification: scope.qualification,
                    requiredUnits: scope.requiredUnits,
                },
            }
        );
        return {
            descriptor: prepared.dependency,
            dependency: {
                kind: "scoped-document",
                id,
                version: scope.version,
                hash: document.hash,
                purpose,
                scope: { request, dependency: prepared.dependency },
            },
            sources: prepared.modelFacingProjection.sources.map(unit => ({
                kind: "document",
                id,
                version: scope.version,
                hash: unit.hash,
                purpose,
                audience: "company",
                ref: unit.ref,
                text: unit.text,
                title: unit.title,
            })),
        };
    };
    const original = await fitTopicEvidence(
        "00000000-0000-4000-8000-000000000010",
        seed,
        { selected: [{ ref: documents[0]!.ref, topicIds: [], spans: [{ start: 0, end: 400 }] }] },
        read,
        { evidenceCapBytes: 16000 }
    );
    const source: SavedPrimary = {
        runId: "00000000-0000-4000-8000-000000000010",
        workId: "heldout:g:16000",
        caseId: "g",
        enterprise: "Example",
        workspaceId: "1",
        arm: "configured-live",
        status: "ok",
        topics: [1, 2, 3].map(n => ({ caseId: String(n), topicId: "topic-" + n })),
        retrievalLimits: { sharedEvidenceBytes: 16000, sourceUnits: 16 },
        cohort: "heldout",
        snapshot: original.input,
        offered: documents.map(d => ({ documentId: d.id, versionId: d.version, ref: d.ref })),
        topicAttribution: {
            observable: true,
            entries: [{ documentId: "2", versionId: "2", topicIds: [] }],
        },
    };
    const trace = {
        events: [
            {
                kind: "response",
                response: {
                    toolCalls: [
                        {
                            id: "accepted",
                            name: "submit_result",
                            arguments: {
                                selected: [{ ref: "doc:2@2", spans: [{ start: 0, end: 400 }] }],
                            },
                        },
                    ],
                },
            },
        ],
    };
    return { source, seed, read, trace, original };
}
describe("offline live selected documents plus lexical windows", () => {
    it("preserves original explorer ranges and automatic lane while adding question windows and backfill", async () => {
        const setup = await fixture();
        const result = await fitLiveDocumentsWindows(setup);
        expect(result.provenance).toBe("explicit-model-selection");
        expect(result.automaticLaneOnlyDocuments).toBe(1);
        const parent = result.frozen.input.scopedEvidence!.find(
            parent => parent.documentId === "2"
        )!;
        expect(parent.units.some(unit => unit.start <= 0 && unit.end >= 400)).toBe(true);
        expect(
            result.frozen.input.sources.some(source =>
                source.text.includes("launch critical decision")
            )
        ).toBe(true);
        const oldLane = setup.original.input.scopedEvidence!.find(
            parent => parent.documentId === "4"
        )!;
        const newLane = result.frozen.input.scopedEvidence!.find(
            parent => parent.documentId === "4"
        )!;
        expect(newLane.units.map(({ start, end }) => ({ start, end }))).toEqual(
            oldLane.units.map(({ start, end }) => ({ start, end }))
        );
        expect(result.frozen.dependencies.some(parent => parent.id === "3")).toBe(true);
        expect(new Set(result.frozen.dependencies.map(parent => parent.id)).size).toBe(
            result.frozen.dependencies.length
        );
        expect(
            result.frozen.input.sources.reduce(
                (sum, source) => sum + Buffer.byteLength(source.text),
                0
            )
        ).toBeLessThanOrEqual(16000);
    });
    it.each(["submission_invalid", "tool_overflow", "total_call_limit"])(
        "ignores rejected %s submissions when recovering explicit document choices",
        async code => {
            const setup = await fixture();
            const trace = {
                events: [
                    ...setup.trace.events,
                    {
                        kind: "response",
                        response: {
                            toolCalls: [
                                {
                                    id: "rejected",
                                    name: "submit_result",
                                    arguments: { selected: [{ ref: "doc:3@3", spans: [] }] },
                                },
                            ],
                        },
                    },
                    { kind: "tool_validation", callId: "rejected", code },
                ],
            };
            expect(archivedChosenDocuments(setup.seed, setup.source, trace).refs).toEqual([
                "doc:2@2",
            ]);
        }
    );
    it("omits accepted fixed empty refs without discarding explicit provenance", async () => {
        const setup = await fixture();
        const trace = {
            events: [
                {
                    kind: "response",
                    response: {
                        toolCalls: [
                            {
                                id: "accepted",
                                name: "submit_result",
                                arguments: {
                                    selected: [
                                        { ref: "doc:1@1", spans: [] },
                                        { ref: "doc:2@2", spans: [] },
                                    ],
                                },
                            },
                        ],
                    },
                },
            ],
        };
        expect(archivedChosenDocuments(setup.seed, setup.source, trace)).toEqual({
            refs: ["doc:2@2"],
            provenance: "explicit-model-selection",
        });
    });
    it("marks conservative archive inference and excludes automatic lane-only docs", async () => {
        const setup = await fixture();
        setup.source.topicAttribution = { observable: false, entries: [] };
        expect(archivedChosenDocuments(setup.seed, setup.source, null)).toEqual({
            refs: ["doc:2@2"],
            provenance: "archive-inferred",
        });
    });
    it("keeps actual failed submissions failed with the original code and zero incremental calls", async () => {
        const setup = await fixture();
        const failed = {
            ...setup.source,
            status: "failed",
            failure: "topic_exploration_failed:submission_missing",
            snapshot: undefined,
        };
        const result = await projectSavedPrimary(failed, {
            schemaVersion: "live-docs-windows-state/1",
            referencesSha256: "",
            groupsSha256: "",
            documents: {},
            runs: {},
        });
        expect(result.status).toBe("failed");
        expect(result).toMatchObject({ failure: failed.failure });
        expect(result.accounting.paidModelCalls).toBe(0);
        expect(result).not.toHaveProperty("generation");
    });
    it("uses exactly one pinned primary per group and cap", async () => {
        const setup = await fixture();
        const groups = [
            {
                groupId: "g",
                enterprise: "Example",
                workspaceId: "1",
                topics: [1, 2, 3].map(n => ({ caseId: String(n), question: "Question" })),
            },
        ];
        const eight = {
            ...setup.source,
            workId: "heldout:g:8000",
            retrievalLimits: { sharedEvidenceBytes: 8000, sourceUnits: 16 },
        };
        expect(
            primaryReferences(
                [setup.source, eight, { ...setup.source, arm: "configured-live+backfill" }],
                groups
            )
        ).toHaveLength(2);
        expect(() => primaryReferences([setup.source, eight, setup.source], groups)).toThrow(
            "projection_reference_invalid"
        );
    });
});
