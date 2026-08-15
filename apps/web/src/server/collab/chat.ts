/**
 * Adapts this deployment's chat model registry to the collaboration engine's
 * single `CollabChatFn` entry point.
 *
 * The engine deliberately knows nothing about routes, endpoints, or reasoning
 * behavior — it asks for text and gets text. Everything model-shaped is
 * resolved here, which is also why a remote agent worker can run against a
 * completely different endpoint from the hub without either side caring.
 */

import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

import type { CollabChatFn, CollabChatMessage } from "@launchstack/core/collab";
import { normalizeModelContent } from "@launchstack/core/llm";
import { resolveConfiguredChatModel } from "~/lib/models";

function toLangChain(message: CollabChatMessage): BaseMessage {
    switch (message.role) {
        case "system":
            return new SystemMessage(message.content);
        case "assistant":
            return new AIMessage(message.content);
        default:
            return new HumanMessage(message.content);
    }
}

export interface CollabChatOptions {
    /** Cap on a single turn. Meetings get long; runaway turns get expensive. */
    maxOutputTokens?: number;
    timeoutMs?: number;
}

export function createCollabChatFn(options: CollabChatOptions = {}): CollabChatFn {
    return async ({ messages, route, temperature, maxTokens }) => {
        const resolved = resolveConfiguredChatModel({
            route:
                route === "fast" || route === "reasoning" || route === "vision" ? route : "default",
            temperature,
            maxOutputTokens: maxTokens ?? options.maxOutputTokens ?? 800,
            timeoutMs: options.timeoutMs,
        });

        const reply = await resolved.chat.invoke(
            resolved.prepareMessages(messages.map(toLangChain))
        );
        const text = normalizeModelContent(reply.content).trim();
        if (!text) throw new Error(`Model "${resolved.modelId}" returned an empty turn`);
        return text;
    };
}
