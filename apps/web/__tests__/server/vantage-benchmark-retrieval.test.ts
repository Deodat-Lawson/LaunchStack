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

it("sanitizes arbitrary provider and database errors to a stable code", () => {
    expect(benchmarkFailureCode(new Error("database password=secret\nraw query"))).toBe(
        "benchmark_run_failed"
    );
    expect(benchmarkFailureCode(new Error("provider_timeout"))).toBe("provider_timeout");
});
