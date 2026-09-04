/**
 * AgentModelPort over a ResolvedChatModel — the production adapter. Maps the
 * runner's transcript onto LangChain messages, binds the tool specs, and
 * normalizes the response (text, tool calls, usage) back into the port shape.
 *
 * Models that cannot bind tools fail loudly at construction: an agent loop
 * without tool calling is not an agent loop, and pretending otherwise would
 * silently degrade to prose.
 */

import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

import type { ResolvedChatModel } from "../chat-model-factory";
import { normalizeModelContent } from "../normalize-content";
import { normalizeTokenUsage } from "../usage";
import type { AgentModelPort, AgentToolCall, AgentToolSpec, AgentTranscriptItem } from "./types";

interface BindableChat {
    bindTools?: (tools: unknown[]) => { invoke: (messages: BaseMessage[]) => Promise<unknown> };
}

function toLangchainTools(tools: readonly AgentToolSpec[]): unknown[] {
    return tools.map(tool => ({
        type: "function",
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.jsonSchema,
        },
    }));
}

function toMessages(system: string, transcript: readonly AgentTranscriptItem[]): BaseMessage[] {
    const messages: BaseMessage[] = [new SystemMessage(system)];
    for (const item of transcript) {
        if (item.role === "user") {
            messages.push(new HumanMessage(item.text));
        } else if (item.role === "assistant") {
            messages.push(
                new AIMessage({
                    content: item.text,
                    tool_calls: item.toolCalls.map(call => ({
                        id: call.id,
                        name: call.name,
                        args: (call.arguments ?? {}) as Record<string, unknown>,
                    })),
                })
            );
        } else {
            messages.push(
                new ToolMessage({
                    tool_call_id: item.callId,
                    name: item.name,
                    content: item.content,
                    status: item.isError ? "error" : "success",
                })
            );
        }
    }
    return messages;
}

function readToolCalls(response: unknown): AgentToolCall[] {
    const calls = (response as { tool_calls?: unknown }).tool_calls;
    if (!Array.isArray(calls)) return [];
    const result: AgentToolCall[] = [];
    for (let i = 0; i < calls.length; i++) {
        const call = calls[i] as { id?: unknown; name?: unknown; args?: unknown };
        if (typeof call?.name !== "string") continue;
        result.push({
            id: typeof call.id === "string" && call.id.length > 0 ? call.id : `call_${i}`,
            name: call.name,
            arguments: call.args ?? {},
        });
    }
    return result;
}

export function createLangchainAgentPort(resolved: ResolvedChatModel): AgentModelPort {
    const chat = resolved.chat as unknown as BindableChat;
    if (typeof chat.bindTools !== "function") {
        throw new Error(
            `Model "${resolved.modelId}" does not support tool binding; it cannot host an agent loop.`
        );
    }

    return {
        async respond({ system, transcript, tools }) {
            const bound = chat.bindTools!(toLangchainTools(tools));
            const response = await bound.invoke(toMessages(system, transcript));
            return {
                text: normalizeModelContent((response as { content?: unknown }).content ?? ""),
                toolCalls: readToolCalls(response),
                usage: normalizeTokenUsage(response),
                modelId: resolved.modelId,
            };
        },
    };
}
