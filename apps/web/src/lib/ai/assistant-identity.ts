/**
 * The product never names the model behind it.
 *
 * Which model answers is the operator's configuration (CHAT_BASE_URL and the
 * chat model file), and it can change without the product changing. The screen
 * already never shows a model id; this covers the other way a name reaches
 * the screen — the model saying it. Asked "what are you?", a model answers
 * from its own training, and some introduce themselves unprompted.
 *
 * Applied once, in `resolveConfiguredChatModel`, so every chat this app sends
 * carries it without each prompt builder having to remember.
 */

import {
    SystemMessage,
    coerceMessageLikeToMessage,
    type BaseMessage,
    type BaseMessageLike,
} from "@langchain/core/messages";

export const ASSISTANT_IDENTITY_RULE =
    "Identity: you are Launchstack's AI assistant. Never name or hint at the underlying AI " +
    "model, its version, or the company that built or hosts it, and never introduce yourself " +
    "by a model name. If asked what model you are or who made you, say you are Launchstack's " +
    "assistant and that the underlying model is not disclosed.";

/**
 * `messages` with the identity rule appended to the first system message, or
 * a system message holding it prepended when there is none. Folded into the
 * existing system message rather than added as a second one: not every
 * endpoint accepts more than one, or one that isn't first. A model that takes
 * no system role at all still gets it, because the caller's
 * `prepareMessages` folds system text into the first user turn afterwards.
 */
export function withAssistantIdentity(messages: readonly BaseMessageLike[]): BaseMessage[] {
    const coerced = messages.map(message => coerceMessageLikeToMessage(message));
    const index = coerced.findIndex(message => message.getType() === "system");
    if (index === -1) return [new SystemMessage(ASSISTANT_IDENTITY_RULE), ...coerced];

    const system = coerced[index]!;
    const content =
        typeof system.content === "string"
            ? `${system.content}\n\n${ASSISTANT_IDENTITY_RULE}`
            : [...system.content, { type: "text" as const, text: ASSISTANT_IDENTITY_RULE }];
    return [
        ...coerced.slice(0, index),
        new SystemMessage({ content: content as never }),
        ...coerced.slice(index + 1),
    ];
}
