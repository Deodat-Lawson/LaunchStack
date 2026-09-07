import { describe, expect, it } from "vitest";
import { AIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

import type { ResolvedChatModel } from "../chat-model-factory";
import { createLangchainAgentPort } from "./langchain-port";
import type { AgentToolSpec, AgentTranscriptItem } from "./types";

function fakeResolved(response: unknown): {
    resolved: ResolvedChatModel;
    captured: { tools: unknown[] | null; messages: BaseMessage[] | null };
} {
    const captured: { tools: unknown[] | null; messages: BaseMessage[] | null } = {
        tools: null,
        messages: null,
    };
    const chat = {
        bindTools(tools: unknown[]) {
            captured.tools = tools;
            return {
                invoke(messages: BaseMessage[]) {
                    captured.messages = messages;
                    return Promise.resolve(response);
                },
            };
        },
    };
    return {
        captured,
        resolved: { modelId: "fake-model", chat } as unknown as ResolvedChatModel,
    };
}

const TOOLS: AgentToolSpec[] = [
    { name: "lookup", description: "Look something up", jsonSchema: { type: "object" } },
];

describe("createLangchainAgentPort", () => {
    it("refuses a model without bindTools", () => {
        const resolved = { modelId: "no-tools", chat: {} } as unknown as ResolvedChatModel;
        expect(() => createLangchainAgentPort(resolved)).toThrow(/tool binding/);
    });

    it("maps the transcript onto LangChain messages in order", async () => {
        const { resolved, captured } = fakeResolved(new AIMessage({ content: "hi" }));
        const port = createLangchainAgentPort(resolved);
        const transcript: AgentTranscriptItem[] = [
            { role: "user", text: "question" },
            {
                role: "assistant",
                text: "let me check",
                toolCalls: [{ id: "c1", name: "lookup", arguments: { q: "x" } }],
            },
            { role: "tool", callId: "c1", name: "lookup", content: "found it", isError: false },
        ];
        await port.respond({ system: "sys", transcript, tools: TOOLS });

        const messages = captured.messages!;
        expect(messages).toHaveLength(4);
        expect(messages[0]!.getType()).toBe("system");
        expect(messages[1]!.getType()).toBe("human");
        expect(messages[2]!.getType()).toBe("ai");
        expect(messages[3]!.getType()).toBe("tool");
        const ai = messages[2] as AIMessage;
        expect(ai.tool_calls?.[0]).toMatchObject({ id: "c1", name: "lookup", args: { q: "x" } });
    });

    it("binds tool specs in OpenAI function format", async () => {
        const { resolved, captured } = fakeResolved(new AIMessage({ content: "" }));
        const port = createLangchainAgentPort(resolved);
        await port.respond({ system: "s", transcript: [], tools: TOOLS });
        expect(captured.tools).toEqual([
            {
                type: "function",
                function: {
                    name: "lookup",
                    description: "Look something up",
                    parameters: { type: "object" },
                },
            },
        ]);
    });

    it("normalizes the response: text, tool calls with defaulted ids, usage, model id", async () => {
        const response = new AIMessage({
            content: "working on it",
            tool_calls: [
                { id: "", name: "lookup", args: { q: "a" } },
                { id: "real", name: "lookup", args: { q: "b" } },
            ],
        });
        response.usage_metadata = { input_tokens: 7, output_tokens: 3, total_tokens: 10 };
        const { resolved } = fakeResolved(response);
        const port = createLangchainAgentPort(resolved);
        const result = await port.respond({ system: "s", transcript: [], tools: TOOLS });

        expect(result.text).toBe("working on it");
        expect(result.toolCalls).toEqual([
            { id: "call_0", name: "lookup", arguments: { q: "a" } },
            { id: "real", name: "lookup", arguments: { q: "b" } },
        ]);
        expect(result.usage?.totalTokens).toBe(10);
        expect(result.modelId).toBe("fake-model");
    });

    it("returns empty tool calls when the response has none", async () => {
        const { resolved } = fakeResolved(new AIMessage({ content: "prose only" }));
        const port = createLangchainAgentPort(resolved);
        const result = await port.respond({ system: "s", transcript: [], tools: TOOLS });
        expect(result.toolCalls).toEqual([]);
        expect(result.text).toBe("prose only");
    });
});
