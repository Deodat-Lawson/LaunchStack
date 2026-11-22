import {
    topicSelectionFootprint,
    runTopicExploration,
    topicExplorationFailureCode,
    createScriptedExplorationPort,
} from "~/server/vantage/weekly-review-topic-exploration";
import { prepareTopicSelection } from "~/server/vantage/weekly-review-topic-run";
import type { TopicSeed } from "~/server/vantage/weekly-review-topic-types";
import type { AgentModelPort } from "@launchstack/llm";
it.each([
    ["topic_exploration_failed:transport_no_http", "transport_no_http"],
    ["topic_exploration_failed:http_429", "http_429"],
    ["benchmark_azure_responses_http_503", "http_503"],
    ["benchmark_azure_function_arguments_invalid", "provider_response_invalid"],
    ["topic_exploration_failed:timeout", "timeout"],
    ["unstructured provider failure with details", "provider"],
])("keeps only stable exploration error codes (%s)", (error, reason) => {
    expect(topicExplorationFailureCode(new Error(error))).toBe(
        "topic_exploration_failed:" + reason
    );
});

it.each([false, true])(
    "distinguishes missing from rejected final submissions (invalid=%s)",
    async invalid => {
        const record = jest.fn(async () => {});
        const respond = jest.fn(async () => ({
            text: "",
            toolCalls: invalid
                ? [{ id: "invalid", name: "submit_result", arguments: { malformed: true } }]
                : [],
        }));
        const code = "topic_exploration_failed:submission_" + (invalid ? "invalid" : "missing");
        await expect(
            runTopicExploration({
                catalogue: [],
                topics: [],
                offered: [],
                port: { respond },
                record,
                deadlineAt: Date.now() + 2000,
            })
        ).rejects.toThrow(code);
        expect(respond).toHaveBeenCalledTimes(12);
        expect(record).toHaveBeenLastCalledWith(
            expect.objectContaining({
                events: expect.arrayContaining([{ kind: "failure", code }]),
            })
        );
    }
);

const document = { ref: "doc:1@1", title: "Evidence", text: "中".repeat(1000) };
const budget = {
    maxEvidenceBytes: 2000,
    maxSourceUnits: 2,
    fixedSources: [{ ref: "doc:fixed@1", text: "é" }],
};
it("counts fixed evidence once plus UTF-8 slices after duplicates, overlap and adjacency merge", () => {
    const result = topicSelectionFootprint(
        {
            selected: [
                {
                    ref: document.ref,
                    topicIds: [],
                    spans: [
                        { start: 0, end: 300 },
                        { start: 200, end: 500 },
                    ],
                },
                { ref: document.ref, topicIds: [], spans: [{ start: 500, end: 700 }] },
                { ref: "doc:fixed@1", topicIds: [], spans: [] },
            ],
        },
        [document],
        budget
    );
    expect(result).toMatchObject({
        exact: true,
        rangesWithinLimits: true,
        fixedEvidenceBytes: 2,
        fixedSourceUnits: 1,
        proposedExcerptBytes: 2100,
        proposedExcerptUnits: 1,
        totalEvidenceBytes: 2102,
        totalSourceUnits: 2,
        remainingEvidenceBytes: -102,
        remainingSourceUnits: 0,
        withinEvidenceBudget: false,
        withinSourceUnitBudget: true,
    });
});
it("marks unresolved refs and malformed boundaries as inexact", () => {
    expect(
        topicSelectionFootprint(
            { selected: [{ ref: "not-offered", topicIds: [], spans: [{ start: 0, end: 200 }] }] },
            [document],
            budget
        ).exact
    ).toBe(false);
    expect(
        topicSelectionFootprint(
            { selected: [{ ref: document.ref, topicIds: [], spans: [{ start: 999, end: 1200 }] }] },
            [document],
            budget
        )
    ).toMatchObject({ exact: false, rangesWithinLimits: false });
});
it("reports reads only as possible candidates and the exact attempted submission separately", async () => {
    let turn = 0;
    const notices: Record<string, unknown>[] = [];
    const port: AgentModelPort = {
        async respond(request) {
            expect(request.system).toContain("2000 UTF-8 bytes and 2 source units");
            expect(request.system).toContain("every owner topic and each open question");
            const last = request.transcript.at(-1)!;
            expect(last.role).toBe("user");
            const notice = JSON.parse(
                (last.role === "user" ? last.text : "").slice(
                    (last.role === "user" ? last.text : "").indexOf("{")
                )
            );
            notices.push(notice);
            if (turn++ === 0)
                return {
                    text: "",
                    toolCalls: [
                        {
                            id: "read",
                            name: "read_document_excerpt",
                            arguments: { ref: document.ref, start: 0, end: 200 },
                        },
                    ],
                };
            if (turn === 2) {
                expect(notice.latestProposedSelection).toBeNull();
                expect(notice.possibleReadCandidates).toMatchObject({
                    totalEvidenceBytes: 602,
                    totalSourceUnits: 2,
                });
                return {
                    text: "",
                    toolCalls: [
                        {
                            id: "invalid-topic",
                            name: "submit_result",
                            arguments: {
                                selected: [
                                    {
                                        ref: document.ref,
                                        topicIds: ["missing"],
                                        spans: [{ start: 0, end: 300 }],
                                    },
                                ],
                            },
                        },
                    ],
                };
            }
            expect(notice.latestProposedSelection).toMatchObject({
                totalEvidenceBytes: 902,
                totalSourceUnits: 2,
            });
            return {
                text: "",
                toolCalls: [
                    {
                        id: "final",
                        name: "submit_result",
                        arguments: {
                            selected: [
                                {
                                    ref: document.ref,
                                    topicIds: [],
                                    spans: [{ start: 0, end: 200 }],
                                },
                            ],
                        },
                    },
                ],
            };
        },
    };
    const result = await runTopicExploration({
        catalogue: [],
        topics: [],
        offered: [document],
        fixedRefs: ["doc:fixed@1"],
        evidenceBudget: budget,
        port,
        record: async () => {},
        deadlineAt: Date.now() + 1000,
    });
    expect(result.selected[0]?.spans).toEqual([{ start: 0, end: 200 }]);
    expect(result.trace.events).toContainEqual({
        kind: "selection_footprint",
        footprint: expect.objectContaining({ totalEvidenceBytes: 602, totalSourceUnits: 2 }),
    });
    const tool = result.trace.events.find(event => (event as { kind: string }).kind === "tool") as {
        content: string;
    };
    expect(JSON.parse(tool.content)).not.toHaveProperty("budget");
    expect(notices).toHaveLength(3);
});
it("keeps budget advice advisory and preserves a scripted oversized proposal for production fitting", async () => {
    const port = createScriptedExplorationPort([document]);
    const result = await runTopicExploration({
        catalogue: [],
        topics: [],
        offered: [document],
        evidenceBudget: { ...budget, maxEvidenceBytes: 100, maxSourceUnits: 1 },
        port,
        record: async () => {},
        deadlineAt: Date.now() + 1000,
    });
    expect(result.selected).toHaveLength(1);
    expect(result.trace.events).toContainEqual({
        kind: "selection_footprint",
        footprint: expect.objectContaining({
            withinEvidenceBudget: false,
            withinSourceUnitBudget: false,
        }),
    });
});
it.each([8000, 16000, 32000, 80000])(
    "accepts the explicitly supplied sweep cap %i",
    async evidenceCapBytes => {
        const seed = { manifest: { configuration: { provider: "seeds" } } } as unknown as TopicSeed;
        await expect(
            prepareTopicSelection({
                seed,
                actor: {
                    companyId: "1",
                    userId: "owner",
                    role: "owner",
                    canRead: true,
                    canMutate: true,
                    documentScope: { kind: "everything" },
                },
                digests: new Map(),
                evidenceCapBytes,
                deadlineAt: Date.now() + 1000,
                query: async () => [],
                record: async () => {},
            })
        ).resolves.toBeNull();
    }
);
it("rejects an unsupported sweep cap before provider work", async () => {
    const seed = { manifest: { configuration: { provider: "seeds" } } } as unknown as TopicSeed;
    await expect(
        prepareTopicSelection({
            seed,
            actor: {
                companyId: "1",
                userId: "owner",
                role: "owner",
                canRead: true,
                canMutate: true,
                documentScope: { kind: "everything" },
            },
            digests: new Map(),
            evidenceCapBytes: 10000,
            deadlineAt: Date.now() + 1000,
            query: async () => [],
            record: async () => {},
        })
    ).rejects.toThrow("evidence_budget_invalid");
});
