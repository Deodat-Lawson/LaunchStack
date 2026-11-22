import { AZURE_LIVE_LIMIT, projectAzureLive } from "../../scripts/vantage-benchmark-azure-plan";
import {
    assertBenchmarkDatabaseUrl,
    benchmarkFailureCode,
    BenchmarkQuestionSchema,
    runBenchmarkRetrieval,
} from "../../scripts/vantage-benchmark-retrieval";
it.each([
    "postgres://u:p@prod.example/vantage_rag_benchmark_20261121",
    "postgres://u:p@127.0.0.1/production",
    "https://localhost/vantage_rag_benchmark_20261121",
    "postgres://u:p@localhost:55569/vantage_rag_benchmark_20261121",
    "postgres://u:p@127.0.0.1:5432/vantage_rag_benchmark_20261121",
    "postgres://u:p@127.0.0.1:55569/vantage_rag_benchmark_20261121_other",
    "postgres://u:p@127.0.0.1:55569/vantage_rag_benchmark_20261121?sslmode=require",
    "postgres://u:p@127.0.0.1:55569/vantage_rag_benchmark_20261121#fragment",
    "postgres://u:p@127.0.0.1:55569/vantage_rag_benchmark_20261121?",
    "postgres://u:p@127.0.0.1:55569/vantage_rag_benchmark_20261121#",
])("rejects shared or non-benchmark database %s", url =>
    expect(() => assertBenchmarkDatabaseUrl(url)).toThrow("benchmark_local_database_required")
);
it("allows the isolated loopback benchmark database", () =>
    expect(() =>
        assertBenchmarkDatabaseUrl("postgres://u:p@127.0.0.1:55569/vantage_rag_benchmark_20261121")
    ).not.toThrow());
it("rejects benchmark labels at the runner input boundary", () => {
    expect(() =>
        BenchmarkQuestionSchema.parse({
            caseId: "ordinal-1",
            enterprise: "Fictional",
            workspaceId: "1",
            question: "What changed?",
            supportingFacts: ["secret"],
        })
    ).toThrow();
});
it("rejects owner/workspace mismatch before collection", async () => {
    const transaction = jest.fn();
    await expect(
        runBenchmarkRetrieval({
            request: {
                caseId: "1",
                enterprise: "Fictional",
                workspaceId: "1",
                question: "What changed?",
            },
            arm: "scripted",
            databaseUrl: "postgres://u:p@127.0.0.1:55569/vantage_rag_benchmark_20261121",
            database: { transaction },
            loadActor: async () => ({
                companyId: "2",
                userId: "owner",
                role: "owner",
                canRead: true,
                canMutate: true,
                documentScope: { kind: "everything" },
            }),
            week: "2026-11-09",
            asOf: "2026-11-15T00:00:00.000Z",
        })
    ).rejects.toThrow("benchmark_actor_invalid");
    expect(transaction).not.toHaveBeenCalled();
});
it("requires explicitly supplied guarded providers for the prospective paid arm", async () => {
    const loadActor = jest.fn();
    await expect(
        runBenchmarkRetrieval({
            request: {
                caseId: "1",
                enterprise: "Fictional",
                workspaceId: "1",
                question: "What changed?",
            },
            arm: "configured-live",
            databaseUrl: "postgres://u:p@127.0.0.1:55569/vantage_rag_benchmark_20261121",
            database: { transaction: jest.fn() },
            loadActor,
            week: "2026-11-09",
            asOf: "2026-11-16T00:00:00.000Z",
        })
    ).rejects.toThrow("benchmark_live_requires_guarded_providers");
    expect(loadActor).not.toHaveBeenCalled();
});

it("projects the authorized 100-case schedule and accounts for warm-up and accrued exposure", () => {
    const planned = projectAzureLive({
        remainingCases: 100,
        missingDigestBytes: Array<number>(21).fill(10_000),
    });
    expect(planned.limitUsd).toBe(10);
    expect(planned.projectedUsd).toBeLessThan(AZURE_LIVE_LIMIT);
    expect(planned.missingDigests).toBe(21);
    expect(
        projectAzureLive({
            remainingCases: 90,
            currentExposureUsd: 2,
            completedExplorationCases: 10,
            completedExplorationExposureUsd: 2,
        }).projectedUsd
    ).toBeGreaterThan(AZURE_LIVE_LIMIT);
});

it("sanitizes arbitrary provider and database errors to a stable code", () => {
    expect(benchmarkFailureCode(new Error("database password=secret\nraw query"))).toBe(
        "benchmark_run_failed"
    );
    expect(benchmarkFailureCode(new Error("provider_timeout"))).toBe("provider_timeout");
});
import * as benchmarkAuthority from "~/server/vantage/weekly-review-authority";
import * as benchmarkRepository from "~/server/vantage/weekly-review-repository";
import type {
    WeeklyReviewContext,
    WeeklyReviewDatabase,
    WeeklyReviewQuery,
} from "~/server/vantage/weekly-review-types";
import {
    BenchmarkGroupSchema,
    benchmarkTopicAttribution,
} from "../../scripts/vantage-benchmark-retrieval";
function groupRequest(size: number) {
    return {
        groupId: "g" + size + "-" + "a".repeat(64),
        enterprise: "Fictional",
        workspaceId: "1",
        topics: Array.from({ length: size }, (_, index) => ({
            caseId: "question-" + index,
            question: "Question " + index + "?",
        })),
    };
}
it.each([3, 5])("accepts a strict label-free group of %i topics", size => {
    expect(BenchmarkGroupSchema.parse(groupRequest(size)).topics).toHaveLength(size);
});
it.each([0, 1, 2, 4, 6])("rejects unsupported group size %i", size => {
    expect(() => BenchmarkGroupSchema.parse(groupRequest(size))).toThrow();
});
it("rejects duplicate case IDs and nested evaluation labels", () => {
    const duplicate = groupRequest(3);
    duplicate.topics[1]!.caseId = duplicate.topics[0]!.caseId;
    expect(() => BenchmarkGroupSchema.parse(duplicate)).toThrow();
    const labels = groupRequest(3);
    Object.assign(labels.topics[0]!, { supportingFacts: ["secret"] });
    expect(() => BenchmarkGroupSchema.parse(labels)).toThrow();
});
it.each([3, 5])(
    "persists %i fresh personal topics but executes one baseline retrieval and shared snapshot",
    async size => {
        const request = groupRequest(size);
        const actor = {
            companyId: "1",
            userId: "owner",
            role: "owner",
            canRead: true,
            canMutate: true,
            documentScope: { kind: "everything" as const },
        };
        const query = jest.fn<ReturnType<WeeklyReviewQuery>, Parameters<WeeklyReviewQuery>>(
            async () => []
        );
        const database: WeeklyReviewDatabase = { transaction: work => work(query) };
        const context: WeeklyReviewContext = {
            actor,
            week: "2026-11-09",
            role: "owner",
            preferenceVersion: 1,
            authorityEpoch: "1",
            mandatoryCoverage: { required: 1, included: 1 },
            sources: [
                {
                    kind: "document",
                    id: "1",
                    version: "1",
                    ref: "doc:1@1",
                    hash: "a".repeat(64),
                    text: "Neutral architecture.",
                    title: "Architecture",
                    purpose: "company-architecture",
                    audience: "company",
                },
            ],
        };
        const collect = jest.fn(async () => context);
        const reserve = jest.fn(async () => ({ id: "run", status: "reserved", created: true }));
        const fail = jest.fn(async () => {});
        const authority = jest
            .spyOn(benchmarkAuthority, "createWeeklyReviewAuthority")
            .mockReturnValue({
                collectWeeklyReviewContext: collect,
                assertCurrentWeeklyReviewAuthority: async () => {},
            } as unknown as ReturnType<typeof benchmarkAuthority.createWeeklyReviewAuthority>);
        const repository = jest
            .spyOn(benchmarkRepository, "createWeeklyReviewRepository")
            .mockReturnValue({ reserve, fail } as unknown as ReturnType<
                typeof benchmarkRepository.createWeeklyReviewRepository
            >);
        try {
            const result = await runBenchmarkRetrieval({
                request,
                arm: "baseline",
                databaseUrl: "postgres://u:p@127.0.0.1:55569/vantage_rag_benchmark_20261121",
                database,
                loadActor: async () => actor,
                week: "2026-11-09",
                asOf: "2026-11-16T00:00:00.000Z",
            });
            expect(result).toMatchObject({
                caseId: request.groupId,
                status: "ok",
                retrievalLimits: { sharedEvidenceBytes: 80000, sourceUnits: 16 },
            });
            const mappings = (result as { topics?: { caseId: string; topicId: string }[] }).topics!;
            expect(mappings.map(topic => topic.caseId)).toEqual(
                request.topics.map(topic => topic.caseId)
            );
            expect(new Set(mappings.map(topic => topic.topicId)).size).toBe(size);
            expect(mappings.every(topic => /^[a-f0-9-]{36}$/.test(topic.topicId))).toBe(true);
            const inserts = query.mock.calls.filter(call =>
                call[0].startsWith("INSERT INTO pdr_ai_v2_vantage_personal_topics")
            );
            expect(inserts).toHaveLength(size);
            expect(inserts.map(call => call[1]![5])).toEqual(
                Array.from({ length: size }, (_, index) => size - index)
            );
            expect(
                inserts.every(
                    call =>
                        call[0].includes("created_at,updated_at") &&
                        call[0].includes("now()-($6::int*interval '1 millisecond')")
                )
            ).toBe(true);
            expect(inserts.map(call => JSON.parse(String(call[1]![4])))).toEqual(
                request.topics.map(topic => ({
                    openQuestions: [topic.question],
                    decisionChangers: [],
                    keywords: [],
                    people: [],
                    metrics: [],
                }))
            );
            expect(collect).toHaveBeenCalledTimes(1);
            expect(reserve).toHaveBeenCalledTimes(1);
            expect(result).toHaveProperty("snapshot.sources", context.sources);
            expect(result).toHaveProperty("topicAttribution", {
                level: "document-version",
                provenance: "exploration_submission_filtered_to_frozen_survivors",
                observable: false,
                entries: [],
            });
            context.sources[0]!.text = "\u00e9".repeat(40001);
            const oversized = await runBenchmarkRetrieval({
                request,
                arm: "baseline",
                databaseUrl: "postgres://u:p@127.0.0.1:55569/vantage_rag_benchmark_20261121",
                database,
                loadActor: async () => actor,
                week: "2026-11-09",
                asOf: "2026-11-16T00:00:00.000Z",
            });
            expect(oversized).toMatchObject({
                caseId: request.groupId,
                status: "failed",
                failure: "benchmark_group_evidence_budget_exceeded",
            });
            expect((oversized as { topics?: unknown[] }).topics).toHaveLength(size);
        } finally {
            authority.mockRestore();
            repository.mockRestore();
        }
    }
);
it("retains only explicitly submitted topic tags for exact document versions surviving the shared freeze", () => {
    const result = benchmarkTopicAttribution({
        arm: "configured-live",
        selection: {
            selected: [
                { ref: "doc:2@20", topicIds: ["topic-a"], spans: [] },
                { ref: "doc:3@30", topicIds: ["topic-b"], spans: [] },
                { ref: "doc:2@21", topicIds: ["topic-c"], spans: [] },
            ],
        },
        documents: [
            { ref: "doc:2@20", id: "2", version: "20" },
            { ref: "doc:3@30", id: "3", version: "30" },
            { ref: "doc:2@21", id: "2", version: "21" },
        ],
        selected: [{ documentId: "2", versionId: "20" }],
    });
    expect(result).toMatchObject({
        observable: true,
        entries: [{ documentId: "2", versionId: "20", topicIds: ["topic-a"] }],
    });
});
it("distinguishes observable empty live tags from arms with no tag diagnostic", () => {
    const input = {
        selection: { selected: [{ ref: "doc:2@20", topicIds: [], spans: [] }] },
        documents: [{ ref: "doc:2@20", id: "2", version: "20" }],
        selected: [{ documentId: "2", versionId: "20" }],
    };
    expect(benchmarkTopicAttribution({ ...input, arm: "configured-live" })).toMatchObject({
        observable: true,
        entries: [{ documentId: "2", versionId: "20", topicIds: [] }],
    });
    expect(benchmarkTopicAttribution({ ...input, arm: "scripted" })).toMatchObject({
        observable: false,
        entries: [],
    });
});

it("projects the warm grouped schedule per topic rather than per group", () => {
    const forecast = projectAzureLive({
        remainingCases: 50,
        remainingTopics: 190,
        missingDigestBytes: [],
    });
    expect(forecast).toMatchObject({
        explorationUnit: "topic",
        remainingCases: 50,
        remainingTopics: 190,
        missingDigests: 0,
    });
    expect(forecast.projectedUsd).toBeCloseTo(0.014429102 * 1.5 * 190, 9);
});
