/** One provider call, with SDK retries disabled. The caller owns all repair/retry policy. */
import type { BaseMessageLike } from "@langchain/core/messages";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";
import type { ResolvedChatModel } from "./chat-model-factory";
import { systemMessageFor } from "./messages";
import { normalizeModelContent } from "./normalize-content";
import { singleAttemptChat } from "./openai-compatible-transport";
import { normalizeTokenUsage } from "./usage";

export class InvalidStructuredAttemptError extends Error {
    override readonly name = "InvalidStructuredAttemptError";
    constructor() {
        super("The model returned invalid structured output.");
    }
}
export class StructuredAttemptSetupError extends Error {
    override readonly name = "StructuredAttemptSetupError";
    constructor() {
        super("The model attempt could not be prepared within its limits.");
    }
}
export async function invokeStructuredAttempt<T>(
    resolved: ResolvedChatModel,
    schema: z.ZodType<T>,
    messages: readonly BaseMessageLike[],
    options: {
        signal: AbortSignal;
        timeoutMs: number;
        maxOutputTokens: number;
    }
) {
    let chat;
    try {
        chat = singleAttemptChat(resolved.chat, resolved.behavior, options);
    } catch {
        throw new StructuredAttemptSetupError();
    }
    const prompt = resolved.prepareMessages([
        ...systemMessageFor(
            resolved.behavior,
            `Return only JSON matching this schema, without Markdown fences:\n${JSON.stringify(zodToJsonSchema(schema))}`
        ),
        ...messages,
    ]);
    if (Buffer.byteLength(JSON.stringify(prompt.map(m => m.content)), "utf8") > 24000) {
        throw new StructuredAttemptSetupError();
    }
    const response = await chat.invoke(prompt, { signal: options.signal });
    const text = normalizeModelContent(response.content);
    try {
        if (Buffer.byteLength(text, "utf8") > 32000) throw new Error("oversized");
        return { result: schema.parse(JSON.parse(text)), usage: normalizeTokenUsage(response) };
    } catch {
        throw new InvalidStructuredAttemptError();
    }
}
