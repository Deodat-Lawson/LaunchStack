import {
    createScriptedExplorationPort,
    runTopicExploration,
} from "../src/server/vantage/weekly-review-topic-exploration";
import type { AgentModelPort } from "@launchstack/llm";
const document = {
    ref: "doc:1@2",
    text: "a".repeat(3000),
    digest: { items: [{ location: { start: 1500, end: 1600 } }] },
};
const setup = (port: AgentModelPort) => ({
    catalogue: [],
    topics: [],
    offered: [document],
    port,
    record: jest.fn(async () => {}),
    deadlineAt: Date.now() + 1000,
});
it("selects canonical spans from injected digest locations", async () => {
    const input = setup(createScriptedExplorationPort([document]));
    const result = await runTopicExploration(input);
    expect(result.selected[0]?.spans).toEqual([{ start: 1400, end: 1700 }]);
    expect(input.record).toHaveBeenCalled();
});
it("unknown and cross-tenant refs have the same tool response", async () => {
    let turn = 0;
    const port: AgentModelPort = {
        async respond(request) {
            if (turn++ === 0)
                return {
                    text: "",
                    toolCalls: ["missing", "other-company"].map((ref, index) => ({
                        id: String(index),
                        name: "get_document_digest",
                        arguments: { ref },
                    })),
                };
            const results = request.transcript.filter(item => item.role === "tool");
            expect(results).toHaveLength(2);
            expect(results.map(item => (item.role === "tool" ? item.content : ""))).toEqual([
                '{"error":"not_offered"}',
                '{"error":"not_offered"}',
            ]);
            return {
                text: "",
                toolCalls: [{ id: "final", name: "submit_result", arguments: { selected: [] } }],
            };
        },
    };
    await runTopicExploration(setup(port));
});
it("persists partial trace and times out a provider ignoring abort", async () => {
    const input = setup({ respond: () => new Promise(() => {}) });
    input.deadlineAt = Date.now() + 10;
    await expect(runTopicExploration(input)).rejects.toThrow("timeout");
    expect(input.record).toHaveBeenCalledTimes(2);
});
it("invalid outside-text submission cannot succeed", async () => {
    const input = setup({
        async respond() {
            return {
                text: "",
                toolCalls: [
                    {
                        id: "bad",
                        name: "submit_result",
                        arguments: {
                            selected: [
                                {
                                    ref: document.ref,
                                    topicIds: [],
                                    spans: [{ start: 2900, end: 3500 }],
                                },
                            ],
                        },
                    },
                ],
            };
        },
    });
    await expect(runTopicExploration(input)).rejects.toThrow();
    expect(input.record).toHaveBeenCalled();
});
it("scripted exploration records tools within the full 50-document limits", async () => {
    const documents = Array.from({ length: 50 }, (_, index) => ({
        ...document,
        ref: `doc:${index + 1}@2`,
    }));
    const input = {
        ...setup(createScriptedExplorationPort(documents)),
        offered: documents,
        deadlineAt: Date.now() + 10000,
    };
    const result = await runTopicExploration(input);
    const events = result.trace.events as {
        kind: string;
        name?: string;
        response?: { toolCalls: unknown[] };
    }[];
    expect(
        events.filter(event => event.kind === "tool" && event.name === "get_document_digest")
    ).toHaveLength(50);
    expect(
        events.filter(event => event.kind === "tool" && event.name === "read_document_excerpt")
    ).toHaveLength(8);
    expect(
        events
            .filter(event => event.kind === "response")
            .reduce((total, event) => total + (event.response?.toolCalls.length ?? 0), 0)
    ).toBe(59);
    expect(result.selected).toHaveLength(50);
});
