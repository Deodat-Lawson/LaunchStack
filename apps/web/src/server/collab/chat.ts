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

import {
    trimToCompleteSentence,
    type CollabChatFn,
    type CollabChatMessage,
} from "@launchstack/collab";
import {
    describeChatError,
    normalizeModelContent,
    type ResolveChatModelOptions,
} from "@launchstack/llm";
import { describeChatResolutionFailure, resolveConfiguredChatModel } from "~/lib/models";
import { MEETING_TURN_MAX_OUTPUT_TOKENS, meetingTurnReasoning } from "./turn-budget";

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
    /**
     * Cap on a single turn, reasoning included where the endpoint counts it.
     * Meetings get long; runaway turns get expensive. See `turn-budget.ts`.
     */
    maxOutputTokens?: number;
    timeoutMs?: number;
}

export function createCollabChatFn(options: CollabChatOptions = {}): CollabChatFn {
    return async ({ messages, route, temperature, maxTokens }) => {
        const maxOutputTokens =
            maxTokens ?? options.maxOutputTokens ?? MEETING_TURN_MAX_OUTPUT_TOKENS;
        let resolved;
        try {
            const request: ResolveChatModelOptions = {
                route:
                    route === "fast" || route === "reasoning" || route === "vision"
                        ? route
                        : "default",
                temperature,
                maxOutputTokens,
                timeoutMs: options.timeoutMs,
            };
            // The route decides the model; the turn decides how hard it thinks.
            resolved = resolveConfiguredChatModel(request);
            const reasoningControl = meetingTurnReasoning(resolved.behavior);
            if (reasoningControl) {
                resolved = resolveConfiguredChatModel({ ...request, reasoningControl });
            }
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
        let text = normalizeModelContent(reply.content).trim();
        if (reply.response_metadata?.finish_reason === "length") {
            // The cap cut the reply off: post it up to its last full sentence
            // rather than stop mid-word in front of the room.
            text = trimToCompleteSentence(text);
            console.warn(
                `[collab] A ${resolved.route} turn reached its ${maxOutputTokens}-token cap; posted ${text.length} characters up to the last full sentence.`
            );
            if (!text) {
                throw new Error(`The ${resolved.route} model used up its turn before answering`);
            }
        }
        // Shown in the meeting as the failure detail, so it names the route, not the model.
        if (!text) throw new Error(`The ${resolved.route} model returned an empty turn`);
        return text;
    };
}
