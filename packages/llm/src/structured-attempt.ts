/** One provider call, with SDK retries disabled. The caller owns all repair/retry policy. */
import type { BaseMessageLike } from "@langchain/core/messages";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";
import type { ResolvedChatModel } from "./chat-model-factory";
import { systemMessageFor } from "./messages";
import { normalizeModelContent } from "./normalize-content";
import { hasPreparedRequestTransport, singleAttemptChat } from "./openai-compatible-transport";
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
/** Shared with bounded callers so schema overhead is included before invoking a provider. */
export function structuredSchemaInstruction<T>(schema: z.ZodType<T>): string {
    return `Return only JSON matching this schema, without Markdown fences:\n${JSON.stringify(zodToJsonSchema(schema))}`;
}
export async function invokeStructuredAttempt<T>(
    resolved: ResolvedChatModel,
    schema: z.ZodType<T>,
    messages: readonly BaseMessageLike[],
    options: {
        signal: AbortSignal;
        timeoutMs: number;
        maxOutputTokens: number;
        /** Opt in to a final serialized UTF-8 message ceiling, including endpoint instructions
         * and role structure. Omission preserves the legacy 24000-byte content-only check. */
        maxInputBytes?: number;
        /** Runs after preparation and limit checks, immediately before provider dispatch. */
        beforeDispatch?: () => Promise<void>;
    }
) {
    const exactPreparedLimit = options.maxInputBytes !== undefined;
    const maxInputBytes = options.maxInputBytes ?? 24000;
    if (!Number.isSafeInteger(maxInputBytes) || maxInputBytes < 1)
        throw new StructuredAttemptSetupError();
    const checkPrepared = async (messages: unknown) => {
        if (Buffer.byteLength(JSON.stringify(messages), "utf8") > maxInputBytes)
            throw new StructuredAttemptSetupError();
        options.signal.throwIfAborted();
        await options.beforeDispatch?.();
        options.signal.throwIfAborted();
    };
    let preparationError: unknown;
    let chat;
    try {
        chat = singleAttemptChat(resolved.chat, resolved.behavior, {
            ...options,
            ...(exactPreparedLimit && hasPreparedRequestTransport(resolved.chat)
                ? {
                      guardPreparedRequest: async body => {
                          try {
                              const request: unknown = JSON.parse(body);
                              if (
                                  !request ||
                                  typeof request !== "object" ||
                                  !("messages" in request) ||
                                  !Array.isArray(request.messages)
                              )
                                  throw new StructuredAttemptSetupError();
                              await checkPrepared(request.messages);
                          } catch (error) {
                              preparationError = error;
                              throw error;
                          }
                      },
                  }
                : {}),
        });
    } catch {
        throw new StructuredAttemptSetupError();
    }
    const prompt = resolved.prepareMessages([
        ...systemMessageFor(resolved.behavior, structuredSchemaInstruction(schema)),
        ...messages,
    ]);
    if (!exactPreparedLimit) await checkPrepared(prompt.map(message => message.content));
    else if (!hasPreparedRequestTransport(resolved.chat))
        await checkPrepared(prompt.map(message => message.toDict()));
    const response = await chat.invoke(prompt, { signal: options.signal }).catch(error => {
        throw preparationError ?? error;
    });
    const text = normalizeModelContent(response.content);
    try {
        if (Buffer.byteLength(text, "utf8") > 32000) throw new Error("oversized");
        return { result: schema.parse(JSON.parse(text)), usage: normalizeTokenUsage(response) };
    } catch {
        throw new InvalidStructuredAttemptError();
    }
}
