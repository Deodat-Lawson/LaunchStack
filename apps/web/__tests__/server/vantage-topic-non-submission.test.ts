/** @jest-environment node */
import { runTopicExploration } from "~/server/vantage/weekly-review-topic-exploration";
import type { AgentModelPort } from "@launchstack/llm";
const document = { ref: "doc:1@1", title: "Evidence", text: "canonical evidence ".repeat(1000) };
const read = (id = "read", start = 300, end = 700) => ({
    id,
    name: "read_document_excerpt",
    arguments: { ref: document.ref, start, end },
});
const options = (port: AgentModelPort) => ({
    catalogue: [],
    topics: [{ id: "topic" }],
    offered: [document],
    port,
    record: jest.fn(async (_trace: unknown) => {}),
    deadlineAt: Date.now() + 2000,
});
it.each([false, true])(
    "recovers prior canonical reads after terminal non-submission (invalid=%s)",
    async invalid => {
        let turn = 0;
        const requests: Parameters<AgentModelPort["respond"]>[0][] = [];
        const result = await runTopicExploration(
            options({
                async respond(request) {
                    requests.push(request);
                    turn++;
                    return {
                        text: "",
                        toolCalls:
                            turn === 1
                                ? [read("a"), read("b", 500, 900)]
                                : invalid
                                  ? [
                                        {
                                            id: "invalid" + turn,
                                            name: "submit_result",
                                            arguments: {
                                                selected: [
                                                    {
                                                        ref: "not-offered",
                                                        spans: [{ start: 0, end: 200 }],
                                                    },
                                                ],
                                            },
                                        },
                                    ]
                                  : [],
                    };
                },
            })
        );
        expect(turn).toBe(12);
        expect(requests[11]!.tools.map(tool => tool.name)).toEqual(["submit_result"]);
        expect(requests[11]!.transcript).toContainEqual(
            expect.objectContaining({
                role: "user",
                text: expect.stringContaining("Final submission opportunity"),
            })
        );
        expect(result.selected).toEqual([
            { ref: document.ref, topicIds: [], spans: [{ start: 300, end: 900 }] },
        ]);
        expect(result.degradation).toEqual({
            code: "topic_exploration_degraded:non_submission",
            reason: invalid ? "submission_invalid" : "submission_missing",
            provenance: "successful_canonical_excerpt_reads",
        });
        expect(result.trace.events).toContainEqual(
            expect.objectContaining({ kind: "terminal_non_submission", turn: 12 })
        );
    }
);
it("ends a near-deadline final-only response immediately and does not execute more reads", async () => {
    let now = 1000,
        turn = 0;
    const clock = jest.spyOn(Date, "now").mockImplementation(() => now);
    try {
        const input = options({
            async respond(request) {
                turn++;
                if (turn === 1) {
                    now = 1950;
                    return { text: "", toolCalls: [read()] };
                }
                expect(request.tools.map(tool => tool.name)).toEqual(["submit_result"]);
                return { text: "", toolCalls: [read("forbidden", 2000, 2400)] };
            },
        });
        input.deadlineAt = 2000;
        const result = await runTopicExploration(input);
        expect(turn).toBe(2);
        expect(result.selected[0]!.spans).toEqual([{ start: 300, end: 700 }]);
        expect(result.trace.events).toContainEqual(
            expect.objectContaining({
                kind: "tool_validation",
                code: "submission_only",
                callId: "forbidden",
            })
        );
    } finally {
        clock.mockRestore();
    }
});
it("preserves a valid normal submission without a degradation marker", async () => {
    let turn = 0;
    const result = await runTopicExploration(
        options({
            async respond() {
                turn++;
                return {
                    text: "",
                    toolCalls:
                        turn === 1
                            ? [read()]
                            : [
                                  {
                                      id: "submit",
                                      name: "submit_result",
                                      arguments: {
                                          selected: [
                                              {
                                                  ref: document.ref,
                                                  topicIds: ["topic"],
                                                  spans: [{ start: 300, end: 700 }],
                                              },
                                          ],
                                      },
                                  },
                              ],
                };
            },
        })
    );
    expect(turn).toBe(2);
    expect(result.selected[0]!.topicIds).toEqual(["topic"]);
    expect(result).not.toHaveProperty("degradation");
});
it("preserves valid final-only submission, including an intentional empty selection", async () => {
    let turn = 0;
    const result = await runTopicExploration(
        options({
            async respond() {
                turn++;
                return {
                    text: "",
                    toolCalls:
                        turn === 1
                            ? [read()]
                            : turn === 12
                              ? [
                                    {
                                        id: "submit",
                                        name: "submit_result",
                                        arguments: { selected: [] },
                                    },
                                ]
                              : [],
                };
            },
        })
    );
    expect(result.selected).toEqual([]);
    expect(result).not.toHaveProperty("degradation");
});
it("does not recover after a transport error even if canonical reads succeeded", async () => {
    let turn = 0;
    await expect(
        runTopicExploration(
            options({
                async respond() {
                    turn++;
                    if (turn === 1) return { text: "", toolCalls: [read()] };
                    throw Error("topic_exploration_failed:transport_no_http");
                },
            })
        )
    ).rejects.toThrow("topic_exploration_failed:transport_no_http");
});
it("does not recover when the final-only provider request fails", async () => {
    let turn = 0;
    await expect(
        runTopicExploration(
            options({
                async respond() {
                    turn++;
                    if (turn === 12) throw Error("topic_exploration_failed:http_503");
                    return { text: "", toolCalls: turn === 1 ? [read()] : [] };
                },
            })
        )
    ).rejects.toThrow("topic_exploration_failed:http_503");
    expect(turn).toBe(12);
});
it("does not recover a hard deadline or upstream abort", async () => {
    let turn = 0;
    const input = options({
        async respond() {
            turn++;
            if (turn === 1) return { text: "", toolCalls: [read()] };
            return new Promise(() => {});
        },
    });
    input.deadlineAt = Date.now() + 25;
    await expect(runTopicExploration(input)).rejects.toThrow("topic_exploration_failed:timeout");
    const controller = new AbortController();
    controller.abort();
    await expect(
        runTopicExploration({
            ...options({
                async respond() {
                    throw Error("must not call");
                },
            }),
            signal: controller.signal,
        })
    ).rejects.toThrow("Agent run aborted");
});
it("does not recover authority/persistence failures", async () => {
    const input = options({
        async respond() {
            return { text: "", toolCalls: [read()] };
        },
    });
    input.record.mockRejectedValueOnce(Error("authority_revoked"));
    await expect(runTopicExploration(input)).rejects.toThrow("authority_revoked");
});
it("cannot recover denied IDs, failed reads, digest text or invalid submitted spans", async () => {
    let turn = 0;
    const input = options({
        async respond() {
            turn++;
            return {
                text: "",
                toolCalls:
                    turn === 1
                        ? [
                              {
                                  id: "denied",
                                  name: "read_document_excerpt",
                                  arguments: { ref: "doc:denied@1", start: 0, end: 400 },
                              },
                              {
                                  id: "digest",
                                  name: "get_document_digest",
                                  arguments: { ref: document.ref },
                              },
                          ]
                        : [
                              {
                                  id: "bad" + turn,
                                  name: "submit_result",
                                  arguments: {
                                      selected: [
                                          {
                                              ref: document.ref,
                                              spans: [{ start: 999999, end: 1000000 }],
                                          },
                                      ],
                                  },
                              },
                          ],
            };
        },
    });
    const result = await runTopicExploration(input);
    expect(result.selected).toEqual([]);
    expect(result.degradation?.reason).toBe("submission_invalid");
});
it("keeps recovered ranges within six spans and never merges beyond6000 UTF-16 units", async () => {
    let turn = 0;
    const input = options({
        async respond() {
            turn++;
            return {
                text: "",
                toolCalls: turn === 1 ? [read("first", 0, 4000), read("second", 3500, 7500)] : [],
            };
        },
    });
    const result = await runTopicExploration(input);
    expect(result.selected[0]!.spans).toEqual([{ start: 0, end: 4000 }]);
});

it("ignores a valid-looking overflow submission at a near-deadline final-only turn", async () => {
    let now = 1000,
        turn = 0;
    const clock = jest.spyOn(Date, "now").mockImplementation(() => now);
    try {
        const input = options({
            async respond() {
                turn++;
                if (turn === 1) {
                    now = 1950;
                    return { text: "", toolCalls: [read()] };
                }
                return {
                    text: "",
                    toolCalls: [
                        ...Array.from({ length: 8 }, (_, i) => read("forbidden" + i, 2000, 2400)),
                        {
                            id: "overflow-submit",
                            name: "submit_result",
                            arguments: { selected: [] },
                        },
                    ],
                };
            },
        });
        input.deadlineAt = 2000;
        const result = await runTopicExploration(input);
        expect(turn).toBe(2);
        expect(result.degradation?.reason).toBe("submission_missing");
        expect(result.selected[0]!.spans).toEqual([{ start: 300, end: 700 }]);
        expect(result.trace.events).toContainEqual(
            expect.objectContaining({
                kind: "tool_validation",
                callId: "overflow-submit",
                code: "tool_overflow",
            })
        );
    } finally {
        clock.mockRestore();
    }
});

it.each([false, true])(
    "recovers our soft deadline while awaiting final-only response and fences late output (read=%s)",
    async hasRead => {
        let turn = 0,
            finish!: (response: { text: string; toolCalls: never[] }) => void;
        let finalSignal: AbortSignal | undefined;
        const parent = new AbortController();
        const input = options({
            async respond(request) {
                turn++;
                if (turn === 12) {
                    finalSignal = request.signal;
                    expect(request.tools.map(t => t.name)).toEqual(["submit_result"]);
                    return new Promise(resolve => {
                        finish = resolve;
                    });
                }
                return { text: "", toolCalls: turn === 1 && hasRead ? [read()] : [] };
            },
        });
        const now = Date.now();
        const result = await runTopicExploration({
            ...input,
            deadlineAt: now + 45,
            hardDeadlineAt: now + 1000,
            signal: parent.signal,
        });
        expect(result.degradation).toMatchObject({
            code: "topic_exploration_degraded:non_submission",
            reason: "submission_missing",
        });
        expect(result.selected).toEqual(
            hasRead ? [{ ref: document.ref, topicIds: [], spans: [{ start: 300, end: 700 }] }] : []
        );
        expect(finalSignal?.aborted).toBe(true);
        expect(parent.signal.aborted).toBe(false);
        const before = structuredClone(result.trace);
        finish({ text: "late ignored output", toolCalls: [] });
        await new Promise(resolve => setTimeout(resolve, 5));
        expect(result.trace).toEqual(before);
    }
);
it.each(["ordinary", "external", "hard"])(
    "does not recover a %s hung-response deadline",
    async scenario => {
        const parent = new AbortController();
        let turn = 0;
        const input = options({
            async respond() {
                turn++;
                if (scenario === "ordinary" || turn === 12) return new Promise(() => {});
                return { text: "", toolCalls: turn === 1 ? [read()] : [] };
            },
        });
        const now = Date.now();
        const cancel = scenario === "external" ? setTimeout(() => parent.abort(), 15) : undefined;
        try {
            await expect(
                runTopicExploration({
                    ...input,
                    deadlineAt: now + 40,
                    hardDeadlineAt: scenario === "hard" ? now + 40 : now + 1000,
                    signal: parent.signal,
                })
            ).rejects.toThrow("timeout");
        } finally {
            if (cancel) clearTimeout(cancel);
        }
    }
);
it("does not convert blocked final-response trace persistence into soft recovery", async () => {
    let turn = 0,
        release!: () => void;
    const input = options({
        async respond() {
            turn++;
            return { text: "", toolCalls: turn === 1 ? [read()] : [] };
        },
    });
    input.record.mockImplementation(async trace => {
        const events = (trace as { events: { kind: string }[] }).events;
        if (turn === 12 && events.at(-1)?.kind === "response")
            await new Promise<void>(resolve => {
                release = resolve;
            });
    });
    const now = Date.now();
    await expect(
        runTopicExploration({
            ...input,
            deadlineAt: now + 45,
            hardDeadlineAt: now + 1000,
            signal: new AbortController().signal,
        })
    ).rejects.toThrow("timeout");
    release();
});

it("recovers a near-deadline final-only hung turn before the turn cap", async () => {
    let now = 1000,
        turn = 0;
    const clock = jest.spyOn(Date, "now").mockImplementation(() => now);
    try {
        const input = options({
            async respond(request) {
                turn++;
                if (turn === 1) {
                    now = 1043;
                    return { text: "", toolCalls: [read()] };
                }
                expect(request.tools.map(tool => tool.name)).toEqual(["submit_result"]);
                return new Promise(() => {});
            },
        });
        const result = await runTopicExploration({
            ...input,
            deadlineAt: 1045,
            hardDeadlineAt: 2000,
            signal: new AbortController().signal,
        });
        expect(turn).toBe(2);
        expect(result.degradation?.reason).toBe("submission_missing");
        expect(result.selected[0]!.spans).toEqual([{ start: 300, end: 700 }]);
        expect(result.trace.events).toContainEqual(
            expect.objectContaining({
                kind: "terminal_non_submission",
                turn: 2,
                cause: "soft_deadline_awaiting_final_response",
            })
        );
    } finally {
        clock.mockRestore();
    }
});
