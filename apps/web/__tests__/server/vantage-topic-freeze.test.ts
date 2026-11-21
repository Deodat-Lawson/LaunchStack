import { fitTopicEvidence, mergeTopicSpans } from "~/server/vantage/weekly-review-topic-freeze";
import type { TopicSeed } from "~/server/vantage/weekly-review-topic-types";
import type { createScopedSourceReader } from "~/server/vantage/weekly-review-scoped-selection";
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
            1000
        )
    ).toEqual([{ start: 0, end: 800 }]);
});
it.each([
    [0, 100],
    [-1, 500],
    [500, 1100],
    [0, 6001],
])("rejects invalid range %i..%i", (start, end) => {
    expect(() => mergeTopicSpans([{ start, end }], 1000)).toThrow("range_invalid");
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
it("admits an unselected lane with an authorized scoped reader", async () => {
    const { compileScopedEvidence } = await import(
        "@launchstack/pipelines/vantage/scoped-evidence"
    );
    const { canonicalTextHash } = await import("@launchstack/store/document-digests");
    const seed = fixture();
    const document = seed.documents[0]!;
    document.hash = canonicalTextHash(document.text);
    seed.manifest.lane = [document.ref];
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
    const frozen = await fitTopicEvidence("run", seed, { selected: [] }, read);
    expect(frozen.summary.lane.outcome).toBe("admitted");
    expect(frozen.input.sources).toHaveLength(2);
    expect(frozen.input.sources[0]).toEqual(seed.context.sources[0]);
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
