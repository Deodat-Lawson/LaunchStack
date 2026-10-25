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

import type { CollabChatFn, CollabChatMessage } from "@launchstack/collab";
import { describeChatError, normalizeModelContent } from "@launchstack/llm";
import { describeChatResolutionFailure, resolveConfiguredChatModel } from "~/lib/models";

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
        let resolved;
        try {
            resolved = resolveConfiguredChatModel({
                route:
                    route === "fast" || route === "reasoning" || route === "vision"
                        ? route
                        : "default",
                temperature,
                maxOutputTokens: maxTokens ?? options.maxOutputTokens ?? 800,
                timeoutMs: options.timeoutMs,
            });
        } catch (error) {
            // Posted in the meeting channel like a turn failure, so the same
            // rule applies: the fixed reason, never the configuration error.
            throw new Error(describeChatResolutionFailure(error).message);
        }

        let reply;
        try {
            reply = await resolved.chat.invoke(resolved.prepareMessages(messages.map(toLangChain)));
        } catch (error) {
            // The meeting posts this message in the channel. A provider's own
            // text can name the vendor or its billing page, so only the mapped
            // message is posted and the raw error is logged.
            const friendly = describeChatError(error, resolved.modelId);
            if (friendly) throw new Error(friendly.message);
            console.error("[collab] Agent turn failed:", error);
            throw new Error("The AI service could not answer");
        }
        const text = normalizeModelContent(reply.content).trim();
        // Shown in the meeting as the failure detail, so it names the route, not the model.
        if (!text) throw new Error(`The ${resolved.route} model returned an empty turn`);
        return text;
    };
}
