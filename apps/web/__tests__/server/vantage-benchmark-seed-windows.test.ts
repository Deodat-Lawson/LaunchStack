import {
    BENCHMARK_FREE_ARMS,
    BenchmarkArmSchema,
    runBenchmarkRetrieval,
} from "../../scripts/vantage-benchmark-retrieval";
import * as authorityModule from "~/server/vantage/weekly-review-authority";
import * as repositoryModule from "~/server/vantage/weekly-review-repository";
import * as topicRun from "~/server/vantage/weekly-review-topic-run";
import type { WeeklyReviewContext, WeeklyReviewQuery } from "~/server/vantage/weekly-review-types";
import type { TopicSeed } from "~/server/vantage/weekly-review-topic-types";

it("exposes seeds-windows at the imported arm boundary", () => {
    expect(BenchmarkArmSchema.parse("seeds-windows")).toBe("seeds-windows");
    expect(BENCHMARK_FREE_ARMS).toContain("seeds-windows");
});
it.each([false, true])(
    "wires deterministic seed windows without digest or model calls (grouped=%s)",
    async grouped => {
        const actor = {
            companyId: "1",
            userId: "owner",
            role: "owner",
            canRead: true,
            canMutate: true,
            documentScope: { kind: "everything" as const },
        };
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
                    text: "Neutral architecture",
                    title: "Architecture",
                    purpose: "company-architecture",
                    audience: "company",
                },
            ],
        };
        const seed: TopicSeed = {
            context,
            documents: [],
            manifest: {
                week: "2026-11-09",
                cutoff: "2026-11-16T00:00:00.000Z",
                asOf: "2026-11-16T00:00:00.000Z",
                epoch: "1",
                expectedActiveId: null,
                configuration: { provider: "seeds", scoped: false },
                revisions: { policy: 1, preference: 1, role: null },
                topics: [],
                fixed: context.sources,
                fixedDependencies: context.sources,
                offered: [],
                lane: [],
                carryover: "unavailable",
            },
        };
        context.topicSeed = seed;
        const query: WeeklyReviewQuery = async () => [];
        const collect = jest.fn(async () => context);
        const read = jest.fn();
        const authority = jest
            .spyOn(authorityModule, "createWeeklyReviewAuthority")
            .mockReturnValue({
                collectWeeklyReviewContext: collect,
                assertCurrentWeeklyReviewAuthority: async () => {},
                withTopicSourceReader: async (
                    _q: unknown,
                    _a: unknown,
                    work: (r: unknown) => unknown
                ) => work(read),
            } as never);
        const repository = jest
            .spyOn(repositoryModule, "createWeeklyReviewRepository")
            .mockReturnValue({
                reserveTopic: jest.fn(),
                claimExploration: async () => Date.now() + 150000,
                freezeTopic: async (
                    _a: unknown,
                    _id: unknown,
                    build: (q: WeeklyReviewQuery) => unknown
                ) => build(query),
                fail: jest.fn(),
            } as never);
        const prewarm = jest.spyOn(topicRun, "prewarmTopicDigests").mockImplementation(async () => {
            throw Error("unexpected_digest");
        });
        const explore = jest
            .spyOn(topicRun, "prepareTopicSelection")
            .mockImplementation(async () => {
                throw Error("unexpected_exploration");
            });
        try {
            const base = { enterprise: "Example", workspaceId: "1" };
            const request = grouped
                ? {
                      ...base,
                      groupId: "g1",
                      topics: [1, 2, 3].map(n => ({
                          caseId: String(n),
                          question: "What changed?",
                      })),
                  }
                : { ...base, caseId: "1", question: "What changed?" };
            const result = await runBenchmarkRetrieval({
                request,
                arm: "seeds-windows",
                databaseUrl: "postgres://u:p@127.0.0.1:55569/vantage_rag_benchmark_20261121",
                database: { transaction: work => work(query) },
                loadActor: async () => actor,
                week: "2026-11-09",
                asOf: "2026-11-16T00:00:00.000Z",
                ...(grouped
                    ? {
                          sweep: {
                              cohort: "heldout" as const,
                              protocol: "heldout-reliability" as const,
                              evidenceCapBytes: 8000 as const,
                          },
                      }
                    : {}),
            });
            expect(result.status).toBe("ok");
            expect(collect).toHaveBeenCalledWith(
                actor,
                "2026-11-09",
                expect.anything(),
                expect.objectContaining({ provider: "seeds" })
            );
            expect(result.accounting).toMatchObject({
                paidModelCalls: 0,
                digestProviderCalls: 0,
                explorationResponses: 0,
                explorationToolCalls: 0,
            });
            expect(prewarm).not.toHaveBeenCalled();
            expect(explore).not.toHaveBeenCalled();
            expect(read).not.toHaveBeenCalled();
        } finally {
            authority.mockRestore();
            repository.mockRestore();
            prewarm.mockRestore();
            explore.mockRestore();
        }
    }
);
it.each([
    { cohort: "heldout", evidenceCapBytes: 8000 },
    { cohort: "heldout", evidenceCapBytes: 80000, protocol: "heldout-reliability" },
    { cohort: "exploratory", evidenceCapBytes: 8000, protocol: "heldout-reliability" },
])(
    "retains historical cap guards unless the exact heldout reliability protocol is valid",
    async sweep => {
        const loadActor = jest.fn();
        await expect(
            runBenchmarkRetrieval({
                request: {
                    groupId: "g",
                    enterprise: "Example",
                    workspaceId: "1",
                    topics: [1, 2, 3].map(n => ({ caseId: String(n), question: "What changed?" })),
                },
                arm: "seeds-windows",
                databaseUrl: "postgres://u:p@127.0.0.1:55569/vantage_rag_benchmark_20261121",
                database: { transaction: jest.fn() },
                loadActor,
                week: "2026-11-09",
                asOf: "2026-11-16T00:00:00.000Z",
                sweep: sweep as never,
            })
        ).rejects.toThrow("benchmark_sweep_request_invalid");
        expect(loadActor).not.toHaveBeenCalled();
    }
);
it("excludes scripted exploration from the heldout reliability protocol", async () => {
    await expect(
        runBenchmarkRetrieval({
            request: {
                groupId: "g",
                enterprise: "Example",
                workspaceId: "1",
                topics: [1, 2, 3].map(n => ({ caseId: String(n), question: "What changed?" })),
            },
            arm: "scripted",
            databaseUrl: "postgres://u:p@127.0.0.1:55569/vantage_rag_benchmark_20261121",
            database: { transaction: jest.fn() },
            loadActor: jest.fn(),
            week: "2026-11-09",
            asOf: "2026-11-16T00:00:00.000Z",
            sweep: { cohort: "heldout", evidenceCapBytes: 8000, protocol: "heldout-reliability" },
        })
    ).rejects.toThrow("benchmark_sweep_request_invalid");
});
