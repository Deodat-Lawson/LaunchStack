import { fitTopicEvidence, mergeTopicSpans } from "~/server/vantage/weekly-review-topic-freeze";
import type { TopicSeed } from "~/server/vantage/weekly-review-topic-types";
import type { createScopedSourceReader } from "~/server/vantage/weekly-review-scoped-selection";
import type { PreparedTopicSelection } from "~/server/vantage/weekly-review-topic-run";
import { TopicRetrievalContextSchema } from "@launchstack/pipelines/vantage/topic-retrieval-v1";
import { WeeklyReviewConflict } from "~/server/vantage/weekly-review-types";
const date = "2026-11-15T00:00:00.000Z";
function fixture(): TopicSeed {
    const fixed = {
        kind: "document" as const,
        id: "1",
        ref: "doc:1@1",
        version: "1",
        hash: "a".repeat(64),
        purpose: "company-architecture" as const,
        audience: "company" as const,
        text: "Company architecture",
        title: "Architecture",
    };
    const document = {
        ref: "doc:2@2",
        id: "2",
        version: "2",
        versionDate: date,
        hash: "b".repeat(64),
        audience: "company" as const,
        purpose: "retrieved" as const,
        reason: "change" as const,
        text: "e".repeat(1000),
        title: "Release update",
        category: "Product",
    };
    return {
        context: {
            actor: { companyId: "1", userId: "owner" },
            week: "2026-11-09",
            sources: [fixed],
            role: "owner",
            preferenceVersion: 1,
            authorityEpoch: "1",
            mandatoryCoverage: { required: 1, included: 1 },
        },
        documents: [document],
        manifest: {
            week: "2026-11-09",
            cutoff: date,
            asOf: date,
            epoch: "1",
            expectedActiveId: null,
            configuration: { provider: "seeds", scoped: false },
            revisions: { policy: 1, preference: 1, role: null },
            topics: [],
            fixed: [fixed],
            fixedDependencies: [fixed],
            offered: [document],
            lane: [],
            carryover: "unavailable",
        },
    };
}
const reader = jest.fn() as unknown as ReturnType<typeof createScopedSourceReader>;
it("merges overlapping and adjacent canonical UTF-16 spans", () => {
    expect(
        mergeTopicSpans(
            [
                { start: 300, end: 600 },
                { start: 0, end: 300 },
                { start: 500, end: 800 },
            ],
            "a".repeat(1000)
        )
    ).toEqual([{ start: 0, end: 800 }]);
});
it.each([
    [0, 100],
    [-1, 500],
    [500, 1100],
    [0, 6001],
])("rejects invalid range %i..%i", (start, end) => {
    expect(() => mergeTopicSpans([{ start, end }], "a".repeat(1000))).toThrow("range_invalid");
});
it("keeps architecture, required sources and personal Stars together", async () => {
    const seed = fixture();
    const architecture = seed.context.sources[0]!;
    const required = {
        ...architecture,
        id: "3",
        ref: "doc:3@3",
        version: "3",
        purpose: "workspace-required" as const,
    };
    const star = {
        ...architecture,
        id: "4",
        ref: "doc:4@4",
        version: "4",
        purpose: "personal-star" as const,
        audience: "actor" as const,
    };
    seed.context.sources.push(required, star);
    seed.context.mandatoryCoverage = { required: 2, included: 2 };
    seed.manifest.fixed.push(required, star);
    seed.manifest.fixedDependencies.push(required, star);
    const frozen = await fitTopicEvidence("run", seed, { selected: [] }, reader);
    expect(frozen.input.sources).toEqual([architecture, required, star]);
    expect(frozen.dependencies).toEqual(seed.manifest.fixedDependencies);
});
it("keeps fixed sources and reports none eligible with empty lane", async () => {
    const seed = fixture();
    const frozen = await fitTopicEvidence("run", seed, { selected: [] }, reader);
    expect(frozen.input.sources).toEqual(seed.context.sources);
    expect(frozen.summary.lane.outcome).toBe("none_eligible");
    expect(
        Buffer.byteLength(frozen.input.sources.map(source => source.text).join(""))
    ).toBeLessThanOrEqual(80000);
});
it("rejects an excerpt outside the offered set", async () => {
    const seed = fixture();
    await expect(
        fitTopicEvidence(
            "run",
            seed,
            {
                selected: [
                    { ref: "doc:other@other", topicIds: [], spans: [{ start: 0, end: 200 }] },
                ],
            },
            reader
        )
    ).rejects.toThrow("not_offered");
});
it("rejects an excerpt outside the offered version text", async () => {
    const seed = fixture();
    await expect(
        fitTopicEvidence(
            "run",
            seed,
            { selected: [{ ref: "doc:2@2", topicIds: [], spans: [{ start: 900, end: 1200 }] }] },
            reader
        )
    ).rejects.toThrow("range_invalid");
});
it("fails closed when fixed context exceeds capacity", async () => {
    const seed = fixture();
    seed.context.sources[0]!.text = "x".repeat(81000);
    await expect(fitTopicEvidence("run", seed, { selected: [] }, reader)).rejects.toThrow(
        "mandatory_context_budget_exceeded"
    );
});
async function authorizedReader(document: TopicSeed["documents"][number]) {
    const { compileScopedEvidence } = await import(
        "@launchstack/pipelines/vantage/scoped-evidence"
    );
    const { canonicalTextHash } = await import("@launchstack/store/document-digests");
    document.hash = canonicalTextHash(document.text);
    const read: ReturnType<typeof createScopedSourceReader> = async (
        id,
        purpose,
        cutoff,
        scope,
        revision
    ) => {
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
                chunks: [{ id: "chunk", ordinal: 0, text: document.text }],
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
    return read;
}

it("admits an unselected lane with an authorized scoped reader", async () => {
    const seed = fixture();
    const document = seed.documents[0]!;
    seed.manifest.lane = [document.ref];
    const frozen = await fitTopicEvidence(
        "run",
        seed,
        { selected: [] },
        await authorizedReader(document)
    );
    expect(frozen.summary.lane.outcome).toBe("admitted");
    expect(frozen.input.sources).toHaveLength(2);
    expect(frozen.input.sources[0]).toEqual(seed.context.sources[0]);
});
const degradation = {
    code: "topic_exploration_degraded:non_submission",
    reason: "submission_missing",
    provenance: "successful_canonical_excerpt_reads",
} as const satisfies NonNullable<PreparedTopicSelection["degradation"]>;

it("degraded freeze keeps fixed sources and skips both unread lane and backfill", async () => {
    const seed = fixture();
    seed.manifest.lane = [seed.documents[0]!.ref];
    const read = jest.fn();
    const frozen = await fitTopicEvidence("run", seed, { selected: [], degradation }, read, {
        evidenceCapBytes: 8000,
        backfill: true,
    });
    expect(read).not.toHaveBeenCalled();
    expect(frozen.input.sources).toEqual(seed.context.sources);
    expect(frozen.dependencies).toEqual(seed.manifest.fixedDependencies);
    expect(frozen.summary).toMatchObject({ outcome: "degraded", degradation });
    expect(TopicRetrievalContextSchema.parse(frozen.input.retrievalContext).degradation).toEqual(
        degradation
    );
    expect(frozen.primary?.input.sources).toEqual(frozen.input.sources);
});

it("degraded freeze fits whole prior reads against the byte cap and rereads them under scope", async () => {
    const seed = fixture();
    const document = seed.documents[0]!;
    document.text = "a".repeat(12000);
    const read = jest.fn(await authorizedReader(document));
    const result = {
        degradation,
        selected: [
            {
                ref: document.ref,
                topicIds: [],
                spans: [
                    { start: 500, end: 5000 },
                    { start: 5500, end: 9800 },
                ],
            },
        ],
    };
    const frozen = await fitTopicEvidence("run", seed, result, read, { evidenceCapBytes: 8000 });
    expect(frozen.input.sources.map(source => source.text)).toEqual([
        seed.context.sources[0]!.text,
        document.text.slice(500, 5000),
    ]);
    expect(read.mock.calls[0]?.[3].requiredUnits).toEqual([
        expect.objectContaining({ start: 500, end: 5000 }),
    ]);
    expect(
        frozen.input.sources.reduce((bytes, source) => bytes + Buffer.byteLength(source.text), 0)
    ).toBeLessThanOrEqual(8000);
    const denied = jest
        .fn()
        .mockRejectedValue(new WeeklyReviewConflict("source_authority_changed", 403));
    await expect(
        fitTopicEvidence("run", seed, result, denied, { evidenceCapBytes: 8000 })
    ).rejects.toThrow("source_authority_changed");
});

it("degraded freeze rejects fixed evidence above the byte cap", async () => {
    const seed = fixture();
    seed.context.sources[0]!.text = "a".repeat(8001);
    await expect(
        fitTopicEvidence("run", seed, { selected: [], degradation }, reader, {
            evidenceCapBytes: 8000,
        })
    ).rejects.toThrow("mandatory_context_budget_exceeded");
});

it("keeps all fixed sources when the lane has a capacity shortfall", async () => {
    const seed = fixture();
    const fixed = seed.context.sources[0]!;
    seed.context.sources = Array.from({ length: 16 }, (_, index) => ({
        ...fixed,
        id: String(index + 10),
        ref: `doc:${index + 10}@1`,
    }));
    seed.context.mandatoryCoverage = { required: 16, included: 16 };
    seed.manifest.fixed = [...seed.context.sources];
    seed.manifest.fixedDependencies = [...seed.context.sources];
    seed.manifest.lane = [seed.documents[0]!.ref];
    const frozen = await fitTopicEvidence("run", seed, { selected: [] }, reader);
    expect(frozen.summary.lane.outcome).toBe("capacity_shortfall");
    expect(frozen.input.sources).toEqual(seed.context.sources);
});
it("rejects explicit freeze endpoints inside a surrogate pair", () => {
    const text = "x".repeat(199) + "😀" + "x".repeat(600);
    expect(() => mergeTopicSpans([{ start: 0, end: 200 }], text)).toThrow("range_invalid");
    expect(() => mergeTopicSpans([{ start: 200, end: 500 }], text)).toThrow("range_invalid");
});
it("normalizes a generated seed excerpt before the 6000-unit surrogate boundary", async () => {
    const seed = fixture();
    seed.documents[0]!.text = "x".repeat(5999) + "😀" + "tail".repeat(100);
    const read = jest.fn(async () => {
        throw new Error("inspected");
    });
    await expect(fitTopicEvidence("run", seed, null, read)).rejects.toThrow("inspected");
    expect(read.mock.calls).toEqual(
        expect.arrayContaining([
            expect.arrayContaining([
                expect.objectContaining({
                    requiredUnits: [expect.objectContaining({ start: 0, end: 5999 })],
                }),
            ]),
        ])
    );
});
