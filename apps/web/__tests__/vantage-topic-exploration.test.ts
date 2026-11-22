import {
    createScriptedExplorationPort,
    runTopicExploration,
    type ExplorationTrace,
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
    record: jest.fn(async (_trace: ExplorationTrace) => {}),
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
                '{"error":"not_offered","message":"Use a document handle or ref from the offered catalogue."}',
                '{"error":"not_offered","message":"Use a document handle or ref from the offered catalogue."}',
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
it("normalizes scripted excerpts without splitting a surrogate pair", async () => {
    const documents = [{ ref: "doc:1@1", text: "x".repeat(5999) + "😀" + "tail".repeat(100) }];
    const input = { ...setup(createScriptedExplorationPort(documents)), offered: documents };
    const result = await runTopicExploration(input);
    expect(result.selected[0]?.spans).toEqual([{ start: 0, end: 5999 }]);
});
it("repairs tool windows and rejects explicit submission endpoints within a surrogate pair", async () => {
    const offered = [{ ref: "doc:1@1", text: "x".repeat(199) + "😀" + "tail".repeat(100) }];
    let turn = 0;
    const port: AgentModelPort = {
        async respond(request) {
            if (turn++ === 0)
                return {
                    text: "",
                    toolCalls: [
                        {
                            id: "read",
                            name: "read_document_excerpt",
                            arguments: { ref: "doc:1@1", start: 0, end: 200 },
                        },
                    ],
                };
            const tool = request.transcript.find(item => item.role === "tool");
            if (turn === 2)
                expect(JSON.parse(tool?.role === "tool" ? tool.content : "{}")).toMatchObject({
                    start: 0,
                    end: 201,
                });
            return {
                text: "",
                toolCalls: [
                    {
                        id: "submit",
                        name: "submit_result",
                        arguments: {
                            selected: [
                                { ref: "doc:1@1", topicIds: [], spans: [{ start: 0, end: 200 }] },
                            ],
                        },
                    },
                ],
            };
        },
    };
    await expect(runTopicExploration({ ...setup(port), offered })).rejects.toThrow();
});
it("uses stable handles with titles and canonicalizes submitted refs", async () => {
    const { explorationDocumentHandle } = await import(
        "../src/server/vantage/weekly-review-topic-exploration"
    );
    const offered = [{ ...document, title: "Release evidence" }];
    const handle = explorationDocumentHandle(offered[0]!);
    let turn = 0;
    const port: AgentModelPort = {
        async respond(request) {
            if (turn++ === 0)
                return {
                    text: "",
                    toolCalls: [
                        { id: "digest", name: "get_document_digest", arguments: { handle } },
                        {
                            id: "read",
                            name: "read_document_excerpt",
                            arguments: { handle, center: 2950, length: 4 },
                        },
                    ],
                };
            const digest = request.transcript.find(
                item => item.role === "tool" && item.callId === "digest"
            );
            const excerpt = request.transcript.find(
                item => item.role === "tool" && item.callId === "read"
            );
            expect(JSON.parse(digest?.role === "tool" ? digest.content : "{}")).toMatchObject({
                handle,
                ref: document.ref,
                title: "Release evidence",
            });
            expect(JSON.parse(excerpt?.role === "tool" ? excerpt.content : "{}")).toMatchObject({
                handle,
                title: "Release evidence",
                start: 2800,
                end: 3000,
                ranges: [{ start: 2800, end: 3000 }],
            });
            return {
                text: "",
                toolCalls: [
                    {
                        id: "submit",
                        name: "submit_result",
                        arguments: {
                            selected: [
                                { handle, topicIds: [], spans: [{ start: 2800, end: 3000 }] },
                            ],
                        },
                    },
                ],
            };
        },
    };
    const result = await runTopicExploration({ ...setup(port), offered });
    expect(result.selected[0]?.ref).toBe(document.ref);
    expect(result.selected[0]).not.toHaveProperty("handle");
    expect(result.trace.version).toBe(2);
});
it("pads around centers, clamps boundaries and merges overlapping read windows", async () => {
    let turn = 0;
    const port: AgentModelPort = {
        async respond(request) {
            if (turn++ === 0)
                return {
                    text: "",
                    toolCalls: [
                        {
                            id: "negative",
                            name: "read_document_excerpt",
                            arguments: { ref: document.ref, start: -100, end: 100 },
                        },
                        {
                            id: "merged",
                            name: "read_document_excerpt",
                            arguments: {
                                ref: document.ref,
                                spans: [
                                    { start: 100, end: 180 },
                                    { start: 150, end: 220 },
                                ],
                            },
                        },
                        {
                            id: "outside",
                            name: "read_document_excerpt",
                            arguments: { ref: document.ref, center: 999999, length: 1 },
                        },
                    ],
                };
            const tools = request.transcript.filter(item => item.role === "tool");
            expect(
                tools.map(item => (item.role === "tool" ? JSON.parse(item.content).ranges : []))
            ).toEqual([
                [{ start: 0, end: 200 }],
                [{ start: 40, end: 285 }],
                [{ start: 2800, end: 3000 }],
            ]);
            return {
                text: "",
                toolCalls: [{ id: "submit", name: "submit_result", arguments: { selected: [] } }],
            };
        },
    };
    await runTopicExploration(setup(port));
});
it("executes the first eight calls and replies to every original overflow ID before repair", async () => {
    let turn = 0;
    const port: AgentModelPort = {
        async respond(request) {
            if (turn++ === 0)
                return {
                    text: "",
                    toolCalls: Array.from({ length: 10 }, (_, index) => ({
                        id: "original-" + index,
                        name: "get_document_digest",
                        arguments: { ref: document.ref },
                    })),
                };
            const assistant = request.transcript.find(item => item.role === "assistant");
            expect(assistant?.role === "assistant" ? assistant.toolCalls.length : 0).toBe(10);
            const tools = request.transcript.filter(item => item.role === "tool");
            expect(tools.map(item => (item.role === "tool" ? item.callId : ""))).toEqual(
                Array.from({ length: 10 }, (_, index) => "original-" + index)
            );
            expect(tools.filter(item => item.role === "tool" && item.isError)).toHaveLength(2);
            return {
                text: "",
                toolCalls: [{ id: "final", name: "submit_result", arguments: { selected: [] } }],
            };
        },
    };
    const result = await runTopicExploration(setup(port));
    expect(
        result.trace.events.filter(event => (event as { kind: string }).kind === "tool")
    ).toHaveLength(8);
    expect(
        result.trace.events.filter(event => (event as { code?: string }).code === "tool_overflow")
    ).toHaveLength(2);
});
it("records distinct schema, unknown-tool and submission validation errors", async () => {
    let turn = 0;
    const port: AgentModelPort = {
        async respond() {
            if (turn++ === 0)
                return {
                    text: "",
                    toolCalls: [
                        {
                            id: "schema",
                            name: "read_document_excerpt",
                            arguments: { ref: document.ref, center: "bad" },
                        },
                        { id: "unknown", name: "invented", arguments: {} },
                        {
                            id: "submission",
                            name: "submit_result",
                            arguments: { selected: [{ ref: "not-offered", spans: [] }] },
                        },
                    ],
                };
            return {
                text: "",
                toolCalls: [{ id: "final", name: "submit_result", arguments: { selected: [] } }],
            };
        },
    };
    const result = await runTopicExploration(setup(port));
    const errors = result.trace.events as { kind: string; code?: string }[];
    expect(
        errors.filter(event => event.kind === "tool_validation").map(event => event.code)
    ).toEqual(["schema_invalid", "unknown_tool", "submission_invalid"]);
});
it("caps attempted executable slots at sixty and retains the failure trace", async () => {
    let turn = 0;
    const input = setup({
        async respond() {
            return {
                text: "",
                toolCalls: Array.from({ length: 8 }, (_, index) => ({
                    id: `${turn++}-${index}`,
                    name: "get_document_digest",
                    arguments: { ref: document.ref },
                })),
            };
        },
    });
    await expect(runTopicExploration(input)).rejects.toThrow("call_limit");
    const trace = input.record.mock.calls.at(-1)?.[0] as
        | { events: { kind: string; code?: string }[] }
        | undefined;
    expect(trace?.events.filter(event => event.kind === "tool")).toHaveLength(60);
    expect(trace?.events.filter(event => event.code === "total_call_limit")).toHaveLength(4);
});
