/**
 * Message shaping driven by the selected model's declared behavior.
 *
 * Only one rule lives here today: models that do not accept a `system` role.
 * Dropping the system message would silently discard instructions, so its
 * text is folded into the first user turn instead — no `role: "system"`
 * reaches the wire, and nothing the caller wrote is lost.
 */

import {
    HumanMessage,
    SystemMessage,
    coerceMessageLikeToMessage,
    type BaseMessage,
    type BaseMessageLike,
} from "@langchain/core/messages";
import { normalizeModelContent } from "./normalize-content";
import type { ChatModelBehavior } from "./types";

function isSystem(message: BaseMessage): boolean {
    return message.getType() === "system";
}

/**
 * Normalize `messages` for `behavior`. When system messages are supported
 * this only coerces the input to `BaseMessage[]`.
 */
export function applyMessageBehavior(
    behavior: ChatModelBehavior,
    messages: readonly BaseMessageLike[]
): BaseMessage[] {
    const coerced = messages.map(message => coerceMessageLikeToMessage(message));
    if (behavior.parameters.systemMessages === "supported") return coerced;

    const systemText = coerced
        .filter(isSystem)
        .map(message => normalizeModelContent(message.content).trim())
        .filter(text => text.length > 0)
        .join("\n\n");

    const rest = coerced.filter(message => !isSystem(message));
    if (systemText.length === 0) return rest;

    const firstHuman = rest.findIndex(message => message.getType() === "human");
    if (firstHuman === -1) {
        return [new HumanMessage(systemText), ...rest];
    }

    const target = rest[firstHuman]!;
    const merged =
        typeof target.content === "string"
            ? `${systemText}\n\n${target.content}`
            : // Multimodal turn: keep the parts intact and prepend a text block so
              // image content survives the merge.
              [{ type: "text" as const, text: systemText }, ...target.content];

    return [
        ...rest.slice(0, firstHuman),
        new HumanMessage({ content: merged as never }),
        ...rest.slice(firstHuman + 1),
    ];
}

/** Build a system message only when the model accepts one. */
export function systemMessageFor(behavior: ChatModelBehavior, text: string): BaseMessage[] {
    return behavior.parameters.systemMessages === "supported"
        ? [new SystemMessage(text)]
        : [new HumanMessage(text)];
}
