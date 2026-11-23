import { lexicalBackfillSpan } from "~/server/vantage/weekly-review-topic-backfill";
import { fitTopicEvidence } from "~/server/vantage/weekly-review-topic-freeze";
import { canonicalTextHash } from "@launchstack/store/document-digests";
import { compileScopedEvidence } from "@launchstack/pipelines/vantage/scoped-evidence";
import type { TopicSeed } from "~/server/vantage/weekly-review-topic-types";
import type { createScopedSourceReader } from "~/server/vantage/weekly-review-scoped-selection";
const guidance = [{ openQuestions: ["What changed the launch decision?"], keywords: ["QA"] }];

it("centers backfill on a late canonical lexical match with no prefix fallback", () => {
    const text = "background ".repeat(800) + "launch QA decision changes" + " tail".repeat(800);
    const span = lexicalBackfillSpan(text, guidance, 6000)!;
    expect(span.start).toBeGreaterThan(0);
    expect(text.slice(span.start, span.end)).toContain("launch QA decision");
    expect(span.end - span.start).toBeLessThanOrEqual(6000);
    expect(lexicalBackfillSpan("unrelated prose ".repeat(800), guidance, 6000)).toBeNull();
    expect(lexicalBackfillSpan(text, [], 6000)).toBeNull();
});
it("honors remaining UTF8 bytes while preserving UTF16 boundaries", () => {
    const text = "\ud83d\ude80".repeat(2000) + " launch " + "\u6c49".repeat(2000);
    const span = lexicalBackfillSpan(text, guidance, 800)!;
    expect(text.slice(span.start, span.end)).toContain("launch");
    expect(Buffer.byteLength(text.slice(span.start, span.end))).toBeLessThanOrEqual(800);
    expect(span.end - span.start).toBeGreaterThanOrEqual(200);
    expect(lexicalBackfillSpan(text, guidance, 199)).toBeNull();
});

function fixture() {
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
        "unrelated change ".repeat(70),
        "launch evidence ".repeat(80),
        "background ".repeat(600) + " launch milestone " + " tail".repeat(300),
        "noise ".repeat(500) + " QA acceptance " + " tail".repeat(500),
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
            configuration: { provider: "scripted", scoped: false },
            revisions: { policy: 1, preference: 1, role: null },
            topics: [
                {
                    id: "topic",
                    revision: 1,
                    title: "Launch",
                    ...guidance[0]!,
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
            lane: [documents[0]!.ref],
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
        const document = documents.find(d => d.id === id)!;
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
    return { seed, read };
}
it("does not invent backfill when topic text has no source match", async () => {
    const { seed, read } = fixture();
    seed.manifest.topics[0]!.openQuestions = ["unfindablequasar"];
    seed.manifest.topics[0]!.keywords = [];
    const primary = await fitTopicEvidence("run", seed, { selected: [] }, read);
    const backfill = await fitTopicEvidence("run", seed, { selected: [] }, read);
    expect(backfill.input).toEqual(primary.input);
});
it("keeps a long matched token intact when shrinking to the remaining byte budget", () => {
    const keyword = "a".repeat(400);
    const text = ".".repeat(4000) + keyword + ".".repeat(4000);
    const span = lexicalBackfillSpan(text, [{ openQuestions: [], keywords: [keyword] }], 500)!;
    expect(text.slice(span.start, span.end)).toContain(keyword);
    expect(Buffer.byteLength(text.slice(span.start, span.end))).toBeLessThanOrEqual(500);
});
it("propagates a backfill exact-version authority failure without partial admission", async () => {
    const { seed, read } = fixture();
    const denied: ReturnType<typeof createScopedSourceReader> = async (...args) => {
        if (args[0] === "4") throw new Error("source_authority_changed");
        return read(...args);
    };
    await expect(fitTopicEvidence("run", seed, { selected: [] }, denied)).rejects.toThrow(
        "source_authority_changed"
    );
});
