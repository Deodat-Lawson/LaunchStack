import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { AgentModelPort, AgentModelResponse, AgentToolDefinition } from "./types";
import { AgentAbortedError, AgentBudgetExceededError, AgentStepLimitError } from "./types";
import { SUBMIT_TOOL_NAME, runAgent, toToolSpecs } from "./runner";

const FinalSchema = z.object({ answer: z.string() });

interface RespondInput {
    system: string;
    transcript: readonly unknown[];
    tools: readonly { name: string }[];
}

/** Scripted port: returns queued responses in order and records every call. */
function scriptedPort(responses: AgentModelResponse[]): {
    port: AgentModelPort;
    calls: RespondInput[];
} {
    const calls: RespondInput[] = [];
    const queue = [...responses];
    return {
        calls,
        port: {
            respond(input) {
                calls.push(input as unknown as RespondInput);
                const next = queue.shift();
                if (!next) throw new Error("scripted port exhausted");
                return Promise.resolve(next);
            },
        },
    };
}

function submitCall(args: unknown, id = "c1"): AgentModelResponse {
    return { text: "", toolCalls: [{ id, name: SUBMIT_TOOL_NAME, arguments: args }] };
}

function echoTool(overrides?: Partial<AgentToolDefinition>): AgentToolDefinition {
    return {
        name: "echo",
        description: "Echo the input back",
        inputSchema: z.object({ value: z.string() }),
        run: input => ({ content: `echo:${(input as { value: string }).value}` }),
        ...overrides,
    };
}

describe("runAgent", () => {
    it("returns the validated output on an immediate submit", async () => {
        const { port } = scriptedPort([submitCall({ answer: "42" })]);
        const result = await runAgent(port, {
            system: "sys",
            user: "question",
            tools: [],
            finalSchema: FinalSchema,
            maxTurns: 3,
        });
        expect(result.output).toEqual({ answer: "42" });
        expect(result.turns).toBe(1);
    });

    it("routes tool calls through the tool and feeds results back", async () => {
        const { port, calls } = scriptedPort([
            {
                text: "looking",
                toolCalls: [{ id: "t1", name: "echo", arguments: { value: "hi" } }],
            },
            submitCall({ answer: "done" }),
        ]);
        const result = await runAgent(port, {
            system: "sys",
            user: "go",
            tools: [echoTool()],
            finalSchema: FinalSchema,
            maxTurns: 3,
        });
        expect(result.output).toEqual({ answer: "done" });
        expect(result.turns).toBe(2);

        // The second model call must see the tool result in the transcript.
        const secondTranscript = calls[1]!.transcript as Array<{
            role: string;
            content?: string;
        }>;
        const toolItem = secondTranscript.find(item => item.role === "tool");
        expect(toolItem?.content).toBe("echo:hi");
    });

    it("feeds schema-invalid submissions back as tool errors and accepts the repair", async () => {
        const { port } = scriptedPort([
            submitCall({ wrong: true }),
            submitCall({ answer: "fixed" }),
        ]);
        const result = await runAgent(port, {
            system: "s",
            user: "u",
            tools: [],
            finalSchema: FinalSchema,
            maxTurns: 3,
        });
        expect(result.output).toEqual({ answer: "fixed" });
        const errorItem = result.transcript.find(item => item.role === "tool" && item.isError);
        expect(errorItem).toBeDefined();
        expect((errorItem as { content: string }).content).toContain("Invalid arguments");
    });

    it("contains unknown tool names as error results", async () => {
        const { port } = scriptedPort([
            { text: "", toolCalls: [{ id: "x", name: "nope", arguments: {} }] },
            submitCall({ answer: "ok" }),
        ]);
        const result = await runAgent(port, {
            system: "s",
            user: "u",
            tools: [echoTool()],
            finalSchema: FinalSchema,
            maxTurns: 3,
        });
        const errorItem = result.transcript.find(i => i.role === "tool" && i.isError) as {
            content: string;
        };
        expect(errorItem.content).toContain('Unknown tool "nope"');
        expect(errorItem.content).toContain("echo");
        expect(errorItem.content).toContain(SUBMIT_TOOL_NAME);
    });

    it("contains tool input-validation failures as error results", async () => {
        const { port } = scriptedPort([
            { text: "", toolCalls: [{ id: "x", name: "echo", arguments: { value: 7 } }] },
            submitCall({ answer: "ok" }),
        ]);
        const result = await runAgent(port, {
            system: "s",
            user: "u",
            tools: [echoTool()],
            finalSchema: FinalSchema,
            maxTurns: 3,
        });
        const errorItem = result.transcript.find(i => i.role === "tool" && i.isError) as {
            content: string;
        };
        expect(errorItem.content).toContain("Invalid arguments");
    });

    it("contains tool crashes as error results instead of throwing", async () => {
        const { port } = scriptedPort([
            { text: "", toolCalls: [{ id: "x", name: "echo", arguments: { value: "boom" } }] },
            submitCall({ answer: "ok" }),
        ]);
        const crashing = echoTool({
            run: () => {
                throw new Error("kaboom");
            },
        });
        const result = await runAgent(port, {
            system: "s",
            user: "u",
            tools: [crashing],
            finalSchema: FinalSchema,
            maxTurns: 3,
        });
        expect(result.output).toEqual({ answer: "ok" });
        const errorItem = result.transcript.find(i => i.role === "tool" && i.isError) as {
            content: string;
        };
        expect(errorItem.content).toContain("kaboom");
    });

    it("throws AgentStepLimitError after exactly maxTurns model calls", async () => {
        const never = { text: "thinking…", toolCalls: [] };
        const { port, calls } = scriptedPort([never, never, never]);
        await expect(
            runAgent(port, {
                system: "s",
                user: "u",
                tools: [],
                finalSchema: FinalSchema,
                maxTurns: 3,
            })
        ).rejects.toBeInstanceOf(AgentStepLimitError);
        expect(calls.length).toBe(3);
    });

    it("nudges the model when it answers in prose without tool calls", async () => {
        const { port, calls } = scriptedPort([
            { text: "here is my answer in prose", toolCalls: [] },
            submitCall({ answer: "ok" }),
        ]);
        await runAgent(port, {
            system: "s",
            user: "u",
            tools: [],
            finalSchema: FinalSchema,
            maxTurns: 3,
        });
        const second = calls[1]!.transcript as Array<{ role: string; text?: string }>;
        const nudge = second[second.length - 1]!;
        expect(nudge.role).toBe("user");
        expect(nudge.text).toContain(SUBMIT_TOOL_NAME);
    });

    it("enforces the token budget from endpoint-reported usage", async () => {
        const { port } = scriptedPort([
            {
                text: "",
                toolCalls: [{ id: "t", name: "echo", arguments: { value: "x" } }],
                usage: { inputTokens: 900, outputTokens: 200, totalTokens: 1100 },
            },
        ]);
        await expect(
            runAgent(port, {
                system: "s",
                user: "u",
                tools: [echoTool()],
                finalSchema: FinalSchema,
                maxTurns: 5,
                tokenBudget: 1000,
            })
        ).rejects.toBeInstanceOf(AgentBudgetExceededError);
    });

    it("estimates usage when the endpoint reports none, so the budget still binds", async () => {
        const silent = {
            text: "",
            toolCalls: [{ id: "t", name: "echo", arguments: { value: "x" } }],
        };
        const { port } = scriptedPort([silent, silent, silent]);
        // The estimate charges at least the flat output allowance per turn,
        // so a tiny budget must trip after the first turn.
        await expect(
            runAgent(port, {
                system: "s",
                user: "u",
                tools: [echoTool()],
                finalSchema: FinalSchema,
                maxTurns: 5,
                tokenBudget: 100,
            })
        ).rejects.toBeInstanceOf(AgentBudgetExceededError);
    });

    it("accumulates usage across turns and reports it on success", async () => {
        const { port } = scriptedPort([
            {
                text: "",
                toolCalls: [{ id: "t", name: "echo", arguments: { value: "x" } }],
                usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            },
            {
                ...submitCall({ answer: "ok" }),
                usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 },
                modelId: "test-model",
            },
        ]);
        const result = await runAgent(port, {
            system: "s",
            user: "u",
            tools: [echoTool()],
            finalSchema: FinalSchema,
            maxTurns: 3,
        });
        expect(result.usage.totalTokens).toBe(40);
        expect(result.modelId).toBe("test-model");
    });

    it("throws AgentAbortedError without calling the port when pre-aborted", async () => {
        const { port, calls } = scriptedPort([submitCall({ answer: "x" })]);
        const controller = new AbortController();
        controller.abort();
        await expect(
            runAgent(port, {
                system: "s",
                user: "u",
                tools: [],
                finalSchema: FinalSchema,
                maxTurns: 3,
                signal: controller.signal,
            })
        ).rejects.toBeInstanceOf(AgentAbortedError);
        expect(calls.length).toBe(0);
    });

    it("stops between tool calls when a tool aborts the run", async () => {
        const controller = new AbortController();
        const aborting = echoTool({
            name: "abort_me",
            run: () => {
                controller.abort();
                return { content: "aborted the run" };
            },
        });
        const { port } = scriptedPort([
            {
                text: "",
                toolCalls: [
                    { id: "a", name: "abort_me", arguments: { value: "x" } },
                    { id: "b", name: "abort_me", arguments: { value: "y" } },
                ],
            },
        ]);
        await expect(
            runAgent(port, {
                system: "s",
                user: "u",
                tools: [aborting],
                finalSchema: FinalSchema,
                maxTurns: 3,
                signal: controller.signal,
            })
        ).rejects.toBeInstanceOf(AgentAbortedError);
    });

    it("executes at most 8 tool calls per turn", async () => {
        let executions = 0;
        const counting = echoTool({
            run: input => {
                executions += 1;
                return { content: `echo:${(input as { value: string }).value}` };
            },
        });
        const manyCalls = Array.from({ length: 12 }, (_, i) => ({
            id: `c${i}`,
            name: "echo",
            arguments: { value: String(i) },
        }));
        const { port } = scriptedPort([
            { text: "", toolCalls: manyCalls },
            submitCall({ answer: "ok" }),
        ]);
        await runAgent(port, {
            system: "s",
            user: "u",
            tools: [counting],
            finalSchema: FinalSchema,
            maxTurns: 3,
        });
        expect(executions).toBe(8);
    });

    it("clips oversized tool results", async () => {
        const huge = echoTool({ run: () => ({ content: "x".repeat(40_000) }) });
        const { port } = scriptedPort([
            { text: "", toolCalls: [{ id: "t", name: "echo", arguments: { value: "x" } }] },
            submitCall({ answer: "ok" }),
        ]);
        const result = await runAgent(port, {
            system: "s",
            user: "u",
            tools: [huge],
            finalSchema: FinalSchema,
            maxTurns: 3,
        });
        const toolItem = result.transcript.find(i => i.role === "tool") as { content: string };
        expect(toolItem.content.length).toBeLessThan(31_000);
        expect(toolItem.content).toContain("truncated");
    });

    it("returns on a valid submit even when later calls exist in the same turn", async () => {
        let executed = false;
        const spy = echoTool({
            run: () => {
                executed = true;
                return { content: "ran" };
            },
        });
        const { port } = scriptedPort([
            {
                text: "",
                toolCalls: [
                    { id: "s1", name: SUBMIT_TOOL_NAME, arguments: { answer: "first" } },
                    { id: "t1", name: "echo", arguments: { value: "x" } },
                ],
            },
        ]);
        const result = await runAgent(port, {
            system: "s",
            user: "u",
            tools: [spy],
            finalSchema: FinalSchema,
            maxTurns: 3,
        });
        expect(result.output).toEqual({ answer: "first" });
        expect(executed).toBe(false);
    });

    it("rejects a tool named like the submit tool", async () => {
        const { port } = scriptedPort([]);
        await expect(
            runAgent(port, {
                system: "s",
                user: "u",
                tools: [echoTool({ name: SUBMIT_TOOL_NAME })],
                finalSchema: FinalSchema,
                maxTurns: 3,
            })
        ).rejects.toBeInstanceOf(RangeError);
    });

    it("rejects maxTurns below 1", async () => {
        const { port } = scriptedPort([]);
        await expect(
            runAgent(port, {
                system: "s",
                user: "u",
                tools: [],
                finalSchema: FinalSchema,
                maxTurns: 0,
            })
        ).rejects.toBeInstanceOf(RangeError);
    });

    it("reports each turn through onTurn", async () => {
        const seen: Array<{ turn: number; toolCalls: string[] }> = [];
        const { port } = scriptedPort([
            { text: "", toolCalls: [{ id: "t", name: "echo", arguments: { value: "x" } }] },
            submitCall({ answer: "ok" }),
        ]);
        await runAgent(port, {
            system: "s",
            user: "u",
            tools: [echoTool()],
            finalSchema: FinalSchema,
            maxTurns: 3,
            onTurn: info => seen.push({ turn: info.turn, toolCalls: info.toolCalls }),
        });
        expect(seen).toEqual([
            { turn: 1, toolCalls: ["echo"] },
            { turn: 2, toolCalls: [SUBMIT_TOOL_NAME] },
        ]);
    });
});

describe("toToolSpecs", () => {
    it("appends the submit tool with the final schema", () => {
        const specs = toToolSpecs([echoTool()], FinalSchema, "submit description");
        expect(specs.map(s => s.name)).toEqual(["echo", SUBMIT_TOOL_NAME]);
        expect(specs[1]!.description).toBe("submit description");
        expect(JSON.stringify(specs[1]!.jsonSchema)).toContain("answer");
    });
});
