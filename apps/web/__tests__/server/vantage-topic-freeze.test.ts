import { fitTopicEvidence, mergeTopicSpans } from "~/server/vantage/weekly-review-topic-freeze";
import {
    topicFirstEvidenceStrategy,
    topicManifestHash,
    type TopicSeed,
} from "~/server/vantage/weekly-review-topic-types";
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

async function hybridFixture() {
    const seed = fixture();
    const chosen = seed.documents[0]!;
    chosen.text =
        "uncovered filler ".repeat(800) + " launch acceptance evidence " + "tail ".repeat(1200);
    const extra = {
        ...chosen,
        id: "3",
        version: "3",
        ref: "doc:3@3",
        title: "Seed backfill",
        text: "seed filler ".repeat(800) + " launch seed evidence " + "tail ".repeat(1000),
    };
    seed.documents = [extra, chosen];
    seed.manifest.offered = seed.documents;
    seed.manifest.topics = [
        {
            id: "topic",
            revision: 1,
            title: "Launch",
            openQuestions: ["What changed launch acceptance?"],
            keywords: [],
            decisionChangers: [],
            people: [],
            metrics: [],
            status: "active",
            watches: [],
        },
    ];
    seed.manifest.configuration.evidenceStrategy = "live-docs+windows";
    const readers = new Map(
        await Promise.all(seed.documents.map(async d => [d.id, await authorizedReader(d)] as const))
    );
    const read = jest.fn<
        ReturnType<ReturnType<typeof createScopedSourceReader>>,
        Parameters<ReturnType<typeof createScopedSourceReader>>
    >((...args) => readers.get(args[0])!(...args));
    const result = {
        selected: [{ ref: chosen.ref, topicIds: ["topic"], spans: [{ start: 0, end: 400 }] }],
    };
    return { seed, chosen, extra, read, result };
}
it("pins hybrid opt-in in the manifest hash and rejects unknown strategies", () => {
    const seed = fixture(),
        plain = topicManifestHash(seed.manifest);
    expect(topicFirstEvidenceStrategy({})).toBeUndefined();
    expect(
        topicFirstEvidenceStrategy({ VANTAGE_TOPIC_FIRST_EVIDENCE_STRATEGY: "live-docs+windows" })
    ).toBe("live-docs+windows");
    expect(() =>
        topicFirstEvidenceStrategy({ VANTAGE_TOPIC_FIRST_EVIDENCE_STRATEGY: "other" })
    ).toThrow("strategy_invalid");
    seed.manifest.configuration.evidenceStrategy = "live-docs+windows";
    expect(topicManifestHash(seed.manifest)).not.toBe(plain);
});
it("compares three freezes from one selection and preserves uncovered original ranges", async () => {
    const { seed, chosen, read, result } = await hybridFixture();
    const frozen = await fitTopicEvidence("run", seed, result, read, {
        evidenceCapBytes: 8000,
        compareVariants: true,
    });
    const plain = frozen.comparisons!.live,
        backfill = frozen.comparisons!.liveBackfill;
    expect(plain.input.sources.map(s => s.text).join("")).not.toContain("launch");
    expect(backfill.input.sources.map(s => s.text).join("")).toContain("launch seed evidence");
    expect(
        frozen.input.sources
            .filter(s =>
                frozen.input.scopedEvidence?.some(
                    p => p.documentId === chosen.id && p.units.some(u => u.ref === s.ref)
                )
            )
            .map(s => s.text)
            .join("")
    ).toContain("launch acceptance evidence");
    for (const variant of [plain, backfill, frozen]) {
        expect(variant.input.sources[0]).toEqual(seed.context.sources[0]);
        expect(
            variant.input.sources.some(source => source.text.includes(chosen.text.slice(0, 400)))
        ).toBe(true);
        expect(variant.input.sources.length).toBeLessThanOrEqual(16);
        expect(
            variant.input.sources.reduce((n, source) => n + Buffer.byteLength(source.text), 0)
        ).toBeLessThanOrEqual(8000);
    }
    const stamps = read.mock.calls.map(call => JSON.stringify([call[0], call[3]]));
    expect(new Set(stamps).size).toBe(stamps.length);
    expect(read.mock.calls.filter(call => call[0] === chosen.id)).toHaveLength(2);
    const unpaired = await fitTopicEvidence("run", seed, result, read, { evidenceCapBytes: 8000 });
    expect(unpaired.input).toEqual(frozen.input);
});
it("gives chosen-document windows priority over seed backfill and bounds authorized reads", async () => {
    const { seed, chosen, extra, read, result } = await hybridFixture();
    seed.context.sources[0]!.text = "f".repeat(5000);
    const frozen = await fitTopicEvidence("run", seed, result, read, { evidenceCapBytes: 8000 });
    expect(
        frozen.input.sources
            .filter(source =>
                frozen.input.scopedEvidence?.some(
                    p => p.documentId === chosen.id && p.units.some(u => u.ref === source.ref)
                )
            )
            .map(s => s.text)
            .join("")
    ).toContain("launch acceptance evidence");
    expect(read.mock.calls.filter(call => call[0] === chosen.id)).toHaveLength(2);
    expect(read.mock.calls.slice(0, 2).map(call => call[0])).toEqual([chosen.id, chosen.id]);
    expect(read.mock.calls.filter(call => call[0] === extra.id).length).toBeLessThanOrEqual(1);
    expect(read.mock.calls.length).toBeLessThanOrEqual(3);
    expect(
        frozen.input.sources.reduce((n, source) => n + Buffer.byteLength(source.text), 0)
    ).toBeLessThanOrEqual(8000);
});
it("never expands degraded reads even when hybrid and comparisons are requested", async () => {
    const { seed, chosen, read, result } = await hybridFixture();
    const frozen = await fitTopicEvidence("run", seed, { ...result, degradation }, read, {
        evidenceCapBytes: 8000,
        compareVariants: true,
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(
        frozen.input.sources
            .filter(source =>
                frozen.input.scopedEvidence
                    ?.find(p => p.documentId === chosen.id)
                    ?.units.some(u => u.ref === source.ref)
            )
            .map(s => s.text)
    ).toEqual([chosen.text.slice(0, 400)]);
    expect(frozen.comparisons!.live.input).toEqual(frozen.input);
    expect(frozen.comparisons!.liveBackfill.input).toEqual(frozen.input);
});
it.each(["source_access_denied", "source_authority_changed", "retrieval_acquisition_timeout"])(
    "fails closed on %s during a hybrid upgrade",
    async code => {
        const { seed, read, result } = await hybridFixture();
        read.mockImplementationOnce(read.getMockImplementation()!).mockRejectedValueOnce(
            new WeeklyReviewConflict(code, 403)
        );
        await expect(
            fitTopicEvidence("run", seed, result, read, { evidenceCapBytes: 8000 })
        ).rejects.toThrow(code);
    }
);
it("does not drop six original ranges to force a seventh selected-document window", async () => {
    const { seed, chosen, read } = await hybridFixture();
    seed.documents = [chosen];
    seed.manifest.offered = [chosen];
    const spans = Array.from({ length: 6 }, (_, i) => ({ start: i * 400, end: i * 400 + 200 }));
    const frozen = await fitTopicEvidence(
        "run",
        seed,
        { selected: [{ ref: chosen.ref, topicIds: [], spans }] },
        read,
        { evidenceCapBytes: 16000 }
    );
    expect(
        frozen.input.scopedEvidence![0]!.units.map(({ start, end }) => ({ start, end }))
    ).toEqual(spans);
    expect(read).toHaveBeenCalledTimes(1);
});

it("preserves a plain lane's default range when the selected lane has empty spans", async () => {
    const { seed, chosen, read } = await hybridFixture();
    seed.manifest.lane = [chosen.ref];
    const frozen = await fitTopicEvidence(
        "run",
        seed,
        { selected: [{ ref: chosen.ref, topicIds: [], spans: [] }] },
        read,
        { evidenceCapBytes: 16000, compareVariants: true }
    );
    const prior = frozen.comparisons!.live.input.scopedEvidence!.find(
        proof => proof.documentId === chosen.id
    )!;
    const hybrid = frozen.input.scopedEvidence!.find(proof => proof.documentId === chosen.id)!;
    expect(prior.units.map(({ start, end }) => ({ start, end }))).toEqual([
        { start: 0, end: 6000 },
    ]);
    for (const range of prior.units)
        expect(hybrid.units.some(unit => unit.start <= range.start && unit.end >= range.end)).toBe(
            true
        );
    expect(hybrid.units.length).toBe(2);
    expect(frozen.summary.lane.outcome).toBe("admitted");
    expect(frozen.input.sources[0]).toEqual(seed.context.sources[0]);
});
