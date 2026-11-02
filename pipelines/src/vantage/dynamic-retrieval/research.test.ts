import { describe, expect, it, vi } from "vitest";
import normal from "../../../../fixtures/vantage-context-v0/normal.json";
import {
    createContextResearchPlannerV0,
    createContextResearchProviderV0,
    type ContextResearchToolsV0,
} from "./research";
import { createDynamicRetrievalProviderV0 } from "./retrieve";
import { runDynamicContextV0 } from "./pipeline";
import { createFixtureV0Ports, type FixtureV0Input } from "../context-v0/mocks";
import type { ContextAssemblyInputV0 } from "../context-v0/ports";
import type {
    ContextScopeV0,
    ContextResearchPlanV0,
    ContextSourceEntryV0,
    DynamicRetrievalInputV0,
    PublicCitationV0,
    RequiredContextBundleV0,
} from "../proposals/context-v0";

async function context(): Promise<ContextAssemblyInputV0> {
    const input = structuredClone(normal.retrievalInput) as DynamicRetrievalInputV0;
    input.budgets.maxTokens = 8000;
    return {
        runId: "research-test",
        inputVersion: "test-v1",
        roleContext: input.verifiedRoleContext,
        requiredContext: structuredClone(
            normal.requiredBundle
        ) as unknown as RequiredContextBundleV0,
        retrieval: await createDynamicRetrievalProviderV0().retrieve(input),
        retrievalInput: input,
        research: {
            contractVersion: "v0-proposed",
            mode: "STOP",
            gapPurpose: "not run",
            publicSafeQueryProjection: [],
            internalSourceRefs: [],
            citations: [],
            failures: [],
            status: "stopped",
            asOf: input.reportWindow.asOf,
        },
        reportWindow: input.reportWindow,
        budgets: input.budgets,
    };
}
const projection = normal.researchPlan.publicSafeQueryProjection[0]!;
const questions = [
    {
        id: "market",
        question: "PRIVATE secret product's market funding eligibility?",
        requiredTerms: ["funding eligibility"],
        publicProjectionIds: [projection.projectionId],
    },
];
function researchOptions(tools?: ContextResearchToolsV0) {
    return {
        actor: normal.retrievalInput.actor as ContextScopeV0,
        asOf: normal.retrievalInput.reportWindow.asOf,
        catalog: normal.manifest.sourceRegistry as ContextSourceEntryV0[],
        publicCitations: normal.researchResult.citations as PublicCitationV0[],
        approvedPublicQueries: [projection],
        tools,
    };
}

describe("bounded context research", () => {
    it.each(["broad", "focused"] as const)(
        "reserves mandatory context before %s retrieval",
        async selectionPolicy => {
            const ports = createFixtureV0Ports(normal as unknown as FixtureV0Input);
            const output = await runDynamicContextV0(
                {
                    principalRef: normal.retrievalInput.actor.principalRef,
                    companyId: normal.retrievalInput.actor.companyId,
                    reportWindow: normal.retrievalInput.reportWindow,
                    budgets: { ...normal.retrievalInput.budgets, maxTokens: 8000, maxSources: 3 },
                    runId: "reserved-budget",
                    inputVersion: "dynamic-v1",
                },
                ports,
                { retrieval: { selectionPolicy } }
            );
            expect(output.manifest.selectedRefs).toHaveLength(3);
            expect(output.manifest.selectedRefs.some(ref => ref.id === "doc-starred-roadmap")).toBe(
                true
            );
            expect(output.manifest.retrievalState.selectedRefs).toEqual([]);
        }
    );

    it("rejects a research context assembled from mismatched report windows", async () => {
        const input = await context();
        input.requiredContext.asOf = "2026-10-20T12:00:00Z";
        expect(() => createContextResearchPlannerV0({ questions })(input)).toThrow(
            "authorized prepared context"
        );
    });

    it("records bounded research usage", async () => {
        const result = await createContextResearchProviderV0(
            researchOptions({
                public: async () => normal.researchResult.citations as PublicCitationV0[],
            })
        ).research(normal.researchPlan as ContextResearchPlanV0);
        expect(result.usage.attemptedQueries).toBe(1);
        expect(result.usage.tokenUpperBound).toBeGreaterThan(0);
        expect(result.usage.tokenUpperBound).toBeLessThanOrEqual(
            normal.researchPlan.budgets.maxTokens
        );
        expect(result.usage.excerptChars).toBeLessThanOrEqual(
            normal.researchPlan.budgets.maxExcerptChars
        );
    });
    it("stops when prepared Company Architecture and personal stars cover the question", async () => {
        const input = await context();
        const planner = createContextResearchPlannerV0({
            questions: [
                {
                    id: "roadmap",
                    question: "Do we have roadmap constraints?",
                    requiredTerms: ["roadmap", "constraints"],
                },
            ],
        });
        const plan = planner(input);
        expect(plan.mode).toBe("STOP");
        const tool = vi.fn();
        const result = await createContextResearchProviderV0(
            researchOptions({ public: tool })
        ).research(plan);
        expect(result.status).toBe("stopped");
        expect(tool).not.toHaveBeenCalled();
    });

    it("chooses an authorized internal source before public search", async () => {
        const input = await context();
        const extra: ContextSourceEntryV0 = {
            ...input.retrievalInput!.sourceCatalog[0]!,
            source: { kind: "doc", id: "funding-policy", version: "v1" },
            excerpt: "Funding eligibility requires incorporation.",
        };
        input.retrievalInput!.sourceCatalog.push(extra);
        const plan = createContextResearchPlannerV0({
            questions,
            approvedPublicQueries: [projection],
        })(input);
        expect(plan.mode).toBe("internal");
        expect(plan.internalSourceRefs).toEqual([extra.source]);
        const internal = vi.fn<NonNullable<ContextResearchToolsV0["internal"]>>(async request => [
            request.source,
        ]);
        const publicTool = vi.fn();
        const result = await createContextResearchProviderV0({
            ...researchOptions({ internal, public: publicTool }),
            catalog: input.retrievalInput!.sourceCatalog,
        }).research(plan);
        expect(result.status).toBe("complete");
        expect(result.internalSourceRefs).toEqual([extra.source]);
        expect(internal).toHaveBeenCalledTimes(1);
        expect(publicTool).not.toHaveBeenCalled();
    });

    it("passes only the approved query to the public tool, dropping private extension fields", async () => {
        const input = await context();
        const plan = createContextResearchPlannerV0({
            questions,
            approvedPublicQueries: [projection],
        })(input);
        expect(plan.mode).toBe("public");
        expect(JSON.stringify(plan)).not.toContain("PRIVATE");
        const publicTool = vi.fn<NonNullable<ContextResearchToolsV0["public"]>>(
            async () => normal.researchResult.citations as PublicCitationV0[]
        );
        const polluted = {
            ...plan,
            gapPurpose: "PRIVATE secret gap",
            privateExcerpt: "PRIVATE secret excerpt",
            internalSourceRefs: [input.retrieval.sourceRegistry[0]!.source],
            publicSafeQueryProjection: [
                { ...projection, purpose: "PRIVATE purpose", extra: "PRIVATE extension" },
            ],
        };
        const result = await createContextResearchProviderV0(
            researchOptions({ public: publicTool })
        ).research(polluted);
        expect(result.status).toBe("complete");
        expect(result.citations).toEqual(normal.researchResult.citations);
        const request = publicTool.mock.calls[0]![0];
        expect(Object.keys(request).sort()).toEqual(["limit", "query", "signal"]);
        expect(request.query).toBe(projection.query);
        expect(JSON.stringify(request)).not.toContain("PRIVATE");
        expect(JSON.stringify(result)).not.toContain("PRIVATE");
    });

    it("stops when a gap lacks a public-safe projection", async () => {
        const plan = createContextResearchPlannerV0({ questions })(await context());
        expect(plan.mode).toBe("STOP");
        expect(plan.gapPurpose).toContain("no authorized");
    });

    it("rejects changed query text even with a valid approval token", async () => {
        const plan = structuredClone(normal.researchPlan) as ContextResearchPlanV0;
        plan.publicSafeQueryProjection[0]!.query = "PRIVATE secret fundraising plan";
        const tool = vi.fn();
        await expect(
            createContextResearchProviderV0(researchOptions({ public: tool })).research(plan)
        ).rejects.toThrow("not approved");
        expect(tool).not.toHaveBeenCalled();
    });

    it("blocks gap inspection when required context is revoked or incomplete", async () => {
        const input = await context();
        input.requiredContext.status = "blocked";
        await expect(async () =>
            createContextResearchPlannerV0({ questions })(input)
        ).rejects.toThrow("authorized prepared context");
    });

    it("does not inspect another actor's catalog when planning internal research", async () => {
        const input = await context();
        input.retrievalInput!.sourceCatalog[0]!.audience = { kind: "actor", principalRef: "other" };
        expect(() => createContextResearchPlannerV0({ questions })(input)).toThrow(
            "authorized prepared context"
        );
    });

    it("returns a typed failure for unavailable public research", async () => {
        const result = await createContextResearchProviderV0(researchOptions()).research(
            normal.researchPlan as ContextResearchPlanV0
        );
        expect(result.status).toBe("failed");
        expect(result.failures[0]?.code).toBe("source_unavailable");
        expect(result.publicSafeQueryProjection[0]?.query).toBe(projection.query);
    });

    it("times out and aborts a hung public provider", async () => {
        const plan = structuredClone(normal.researchPlan) as ContextResearchPlanV0;
        plan.budgets.timeoutMs = 20;
        let signal: AbortSignal | undefined;
        const result = await createContextResearchProviderV0(
            researchOptions({
                public: request => {
                    signal = request.signal;
                    return new Promise(() => {});
                },
            })
        ).research(plan);
        expect(result.status).toBe("failed");
        expect(result.failures[0]?.code).toBe("timeout");
        expect(signal?.aborted).toBe(true);
    });

    it("rejects fabricated public citations instead of registering tool output", async () => {
        const result = await createContextResearchProviderV0(
            researchOptions({
                public: async () => [
                    {
                        ...normal.researchResult.citations[0]!,
                        source: { kind: "public", id: "made-up", version: "v1" },
                    },
                ],
            })
        ).research(normal.researchPlan as ContextResearchPlanV0);
        expect(result.status).toBe("failed");
        expect(result.citations).toEqual([]);
        expect(result.failures[0]?.code).toBe("invalid_source");
    });

    it("uses canonical citation metadata rather than trusting a tool title", async () => {
        const result = await createContextResearchProviderV0(
            researchOptions({
                public: async () => [
                    {
                        ...normal.researchResult.citations[0]!,
                        title: "FORGED title",
                        source: {
                            kind: "public",
                            id: "public-market-report",
                            version: "public-v1",
                        },
                    },
                ],
            })
        ).research(normal.researchPlan as ContextResearchPlanV0);
        expect(result.citations[0]?.title).toBe("Public market report");
    });

    it("does not send internal work to a tool after permission revocation", async () => {
        const input = await context();
        const ref = input.retrievalInput!.sourceCatalog[0]!.source;
        const plan: ContextResearchPlanV0 = {
            contractVersion: "v0-proposed",
            mode: "internal",
            gapPurpose: "Need context",
            budgets: input.budgets,
            internalSourceRefs: [ref],
            publicSafeQueryProjection: [],
        };
        const tool = vi.fn();
        const result = await createContextResearchProviderV0({
            ...researchOptions({ internal: tool }),
            catalog: [],
        }).research(plan);
        expect(result.status).toBe("failed");
        expect(tool).not.toHaveBeenCalled();
    });

    it("accounts for public query bytes before spending the token budget", async () => {
        const plan = structuredClone(normal.researchPlan) as ContextResearchPlanV0;
        plan.budgets.maxTokens = 1;
        const tool = vi.fn();
        const result = await createContextResearchProviderV0(
            researchOptions({ public: tool })
        ).research(plan);
        expect(result.status).toBe("partial");
        expect(tool).not.toHaveBeenCalled();
    });

    it("composes the real retriever and research with the existing manifest pipeline", async () => {
        const ports = createFixtureV0Ports(normal as unknown as FixtureV0Input);
        const output = await runDynamicContextV0(
            {
                principalRef: normal.retrievalInput.actor.principalRef,
                companyId: normal.retrievalInput.actor.companyId,
                reportWindow: normal.retrievalInput.reportWindow,
                budgets: { ...normal.retrievalInput.budgets, maxTokens: 8000, maxQueries: 3 },
                runId: "dynamic-integration",
                inputVersion: "dynamic-v1",
            },
            ports,
            {
                research: {
                    questions,
                    approvedPublicQueries: [projection],
                    publicCitations: normal.researchResult.citations as PublicCitationV0[],
                    tools: {
                        public: async () => normal.researchResult.citations as PublicCitationV0[],
                    },
                },
            }
        );
        expect(output.research.mode).toBe("public");
        expect(output.research.status).toBe("complete");
        expect(output.manifest.selectedRefs.some(ref => ref.id === "doc-starred-roadmap")).toBe(
            true
        );
        expect(output.evidenceSnapshot.entries.some(entry => entry.source.kind === "public")).toBe(
            true
        );
    });

    it("does not overspend the shared query budget on optional research", async () => {
        const ports = createFixtureV0Ports(normal as unknown as FixtureV0Input);
        const tool = vi.fn();
        const output = await runDynamicContextV0(
            {
                principalRef: normal.retrievalInput.actor.principalRef,
                companyId: normal.retrievalInput.actor.companyId,
                reportWindow: normal.retrievalInput.reportWindow,
                budgets: { ...normal.retrievalInput.budgets, maxTokens: 8000, maxQueries: 2 },
                runId: "budget-integration",
                inputVersion: "dynamic-v1",
            },
            ports,
            {
                research: {
                    questions,
                    approvedPublicQueries: [projection],
                    tools: { public: tool },
                },
            }
        );
        expect(output.research.mode).toBe("STOP");
        expect(tool).not.toHaveBeenCalled();
    });
});
