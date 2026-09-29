/**
 * Schema-validated results from any configured model.
 *
 * Structured output is invocation behavior, not a route: whichever model
 * serves the caller's route produces the object. Models that declare a native
 * mechanism use it; every other model goes through a strict JSON prompt that
 * carries the schema, is validated with Zod, and gets exactly one repair
 * attempt before failing loudly.
 *
 * One repair, not a loop — a model that cannot satisfy the schema twice in a
 * row will not satisfy it on the fifth try either, and a retry loop turns a
 * clear failure into an expensive one.
 */

import type { BaseMessageLike } from "@langchain/core/messages";
import { HumanMessage } from "@langchain/core/messages";
import { JsonOutputParser, StringOutputParser } from "@langchain/core/output_parsers";
import { zodResponseFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ResolvedChatModel } from "./chat-model-factory";
import { applyMessageBehavior, systemMessageFor } from "./messages";
import { normalizeModelContent } from "./normalize-content";
import type { NativeStructuredOutputMode } from "./types";
import type { ChatTokenUsage } from "./usage";
import { addTokenUsage, normalizeTokenUsage } from "./usage";

export interface StructuredOutputOptions {
    /** Schema/tool name; some endpoints surface it in logs. */
    name: string;
    /** Receives cumulative, schema-shaped partial objects while the model streams. */
    onPartial?: (partial: unknown) => void | Promise<void>;
    /** Aborts the provider request and parser stream when signaled. */
    signal?: AbortSignal;
}

/** A structured result plus what it cost — the meterable envelope. */
export interface StructuredResultWithUsage<T> {
    result: T;
    usage: ChatTokenUsage;
    modelId: string;
}

/** Raised when the model could not produce a schema-valid result. */
export class StructuredOutputError extends Error {
    override readonly name = "StructuredOutputError";
    readonly modelId: string;

    constructor(modelId: string, cause: string) {
        super(
            `Model "${modelId}" did not return a result matching the requested schema after one repair attempt. Last validation error: ${cause}`
        );
        this.modelId = modelId;
    }
}

/** Native mechanism to use, in descending order of schema enforcement. */
export function pickNativeStructuredMode(
    declared: readonly NativeStructuredOutputMode[]
): NativeStructuredOutputMode | undefined {
    if (declared.includes("json-schema")) return "json-schema";
    if (declared.includes("tool-calling")) return "tool-calling";
    if (declared.includes("json-object")) return "json-object";
    return undefined;
}

const LANGCHAIN_METHOD = {
    "json-schema": "jsonSchema",
    "tool-calling": "functionCalling",
    "json-object": "jsonMode",
} as const;

function jsonInstruction(schema: z.ZodType<unknown>, name: string): string {
    const jsonSchema = JSON.stringify(zodToJsonSchema(schema, name), null, 2);
    return [
        "Return only valid JSON matching this JSON Schema.",
        "Do not wrap it in Markdown fences and do not add commentary before or after it.",
        "",
        jsonSchema,
    ].join("\n");
}

function extractJson(text: string): unknown {
    const withoutFence = text
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();

    try {
        return JSON.parse(withoutFence) as unknown;
    } catch {
        // Models often prepend a sentence despite instructions; recover the first
        // balanced-looking object or array rather than failing the whole call.
        const objectStart = withoutFence.indexOf("{");
        const objectEnd = withoutFence.lastIndexOf("}");
        const arrayStart = withoutFence.indexOf("[");
        const arrayEnd = withoutFence.lastIndexOf("]");
        const candidates = [
            objectStart >= 0 && objectEnd > objectStart
                ? withoutFence.slice(objectStart, objectEnd + 1)
                : undefined,
            arrayStart >= 0 && arrayEnd > arrayStart
                ? withoutFence.slice(arrayStart, arrayEnd + 1)
                : undefined,
        ].filter((candidate): candidate is string => Boolean(candidate));

        for (const candidate of candidates) {
            try {
                return JSON.parse(candidate) as unknown;
            } catch {
                // Try the next candidate.
            }
        }
        throw new Error("the response contained no parsable JSON value");
    }
}

function signalOptions(signal: AbortSignal | undefined): { signal: AbortSignal } | undefined {
    return signal === undefined ? undefined : { signal };
}

async function streamJsonOutput(
    resolved: ResolvedChatModel,
    messages: BaseMessageLike[],
    options: StructuredOutputOptions
): Promise<string> {
    const textStream = await resolved.chat
        .pipe(new StringOutputParser())
        .stream(messages, signalOptions(options.signal));
    const parser = new JsonOutputParser<Record<string, unknown>>();
    const textChunks: string[] = [];

    async function* recordedChunks(): AsyncGenerator<string> {
        for await (const text of textStream) {
            textChunks.push(text);
            yield text;
        }
    }

    const parsedStream = parser.transform(recordedChunks(), {});
    for await (const next of parsedStream) {
        if (next === undefined || next === null) continue;
        await options.onPartial?.(next);
    }

    return textChunks.join("");
}

async function invokeJsonFallback<T>(
    resolved: ResolvedChatModel,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    messages: readonly BaseMessageLike[],
    options: StructuredOutputOptions
): Promise<StructuredResultWithUsage<T>> {
    const instructed = resolved.prepareMessages([
        ...systemMessageFor(resolved.behavior, jsonInstruction(schema, options.name)),
        ...messages,
    ]);

    if (!options.onPartial) {
        const modelOptions = signalOptions(options.signal);
        const first = modelOptions
            ? await resolved.chat.invoke(instructed, modelOptions)
            : await resolved.chat.invoke(instructed);
        const firstText = normalizeModelContent(first.content);
        let usage = normalizeTokenUsage(first);

        try {
            return {
                result: schema.parse(extractJson(firstText)),
                usage,
                modelId: resolved.modelId,
            };
        } catch (firstError) {
            const issue = firstError instanceof Error ? firstError.message : String(firstError);
            const repair = applyMessageBehavior(resolved.behavior, [
                ...instructed,
                new HumanMessage(
                    `Your previous response was invalid. Validation error:\n${issue}\n\n` +
                        `Previous response:\n${firstText}\n\nReturn a corrected JSON value only.`
                ),
            ]);

            try {
                const second = modelOptions
                    ? await resolved.chat.invoke(repair, modelOptions)
                    : await resolved.chat.invoke(repair);
                usage = addTokenUsage(usage, normalizeTokenUsage(second));
                return {
                    result: schema.parse(extractJson(normalizeModelContent(second.content))),
                    usage,
                    modelId: resolved.modelId,
                };
            } catch (repairError) {
                throw new StructuredOutputError(
                    resolved.modelId,
                    repairError instanceof Error ? repairError.message : String(repairError)
                );
            }
        }
    }

    const first = await streamJsonOutput(resolved, instructed, options);
    try {
        return {
            result: schema.parse(extractJson(first)),
            usage: {},
            modelId: resolved.modelId,
        };
    } catch (firstError) {
        const issue = firstError instanceof Error ? firstError.message : String(firstError);
        await options.onPartial({});
        const repair = applyMessageBehavior(resolved.behavior, [
            ...instructed,
            new HumanMessage(
                `Your previous response was invalid. Validation error:\n${issue}\n\n` +
                    `Previous response:\n${first}\n\nReturn a corrected JSON value only.`
            ),
        ]);

        const second = await streamJsonOutput(resolved, repair, options);
        try {
            return {
                result: schema.parse(extractJson(second)),
                usage: {},
                modelId: resolved.modelId,
            };
        } catch (repairError) {
            throw new StructuredOutputError(
                resolved.modelId,
                repairError instanceof Error ? repairError.message : String(repairError)
            );
        }
    }
}

async function invokeNativeStreaming<T>(
    resolved: ResolvedChatModel,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    messages: readonly BaseMessageLike[],
    native: NativeStructuredOutputMode,
    options: StructuredOutputOptions
): Promise<T> {
    // Passing JSON Schema instead of Zod is important here: LangChain's Zod
    // parser is a final parser and therefore buffers the whole stream, whereas
    // its JSON-schema parser uses a cumulative partial JSON parser.
    // Match the SDK's non-streaming Zod conversion: plain JSON Schema drops
    // strict mode and leaves defaulted properties out of the required list.
    const outputSchema =
        native === "json-schema"
            ? zodResponseFormat(schema, options.name).json_schema.schema
            : zodToJsonSchema(schema);
    const structured = resolved.chat.withStructuredOutput(outputSchema as Record<string, unknown>, {
        name: options.name,
        method: LANGCHAIN_METHOD[native],
        ...(native === "json-schema" ? { strict: true } : {}),
    });
    const prompt =
        native === "json-object"
            ? [
                  ...systemMessageFor(resolved.behavior, jsonInstruction(schema, options.name)),
                  ...messages,
              ]
            : messages;
    const prepared = applyMessageBehavior(resolved.behavior, prompt);
    const modelOptions = signalOptions(options.signal);
    const structuredStream = modelOptions
        ? await structured.stream(prepared, modelOptions)
        : await structured.stream(prepared);
    let partial: unknown;

    for await (const next of structuredStream) {
        if (next === undefined || next === null) continue;
        partial = next;
        await options.onPartial?.(next);
    }

    return schema.parse(partial);
}

/**
 * Invoke a resolved chat model and validate the result against `schema`.
 * Works for every configured model; the mechanism depends on what the model
 * declares, never on its id.
 */
export async function invokeStructured<T>(
    resolved: ResolvedChatModel,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    messages: readonly BaseMessageLike[],
    options: StructuredOutputOptions
): Promise<T> {
    return (await invokeStructuredWithUsage(resolved, schema, messages, options)).result;
}

/**
 * `invokeStructured`, keeping the response envelope: token usage (summed
 * across the repair attempt when one happens) and the serving model id.
 * Additive fix from the rebuild design (§3.8 P1 prerequisite) — before this,
 * the envelope was discarded and no tool's LLM call could be metered.
 *
 * Streaming structured calls still return the same envelope, but provider
 * usage is unavailable from LangChain's parsed stream and therefore remains
 * absent rather than being reported as zero.
 */
export async function invokeStructuredWithUsage<T>(
    resolved: ResolvedChatModel,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    messages: readonly BaseMessageLike[],
    options: StructuredOutputOptions
): Promise<StructuredResultWithUsage<T>> {
    const native = pickNativeStructuredMode(resolved.behavior.nativeStructuredOutput);
    if (!native) {
        return invokeJsonFallback(resolved, schema, messages, options);
    }

    if (options.onPartial) {
        const result = await invokeNativeStreaming(resolved, schema, messages, native, options);
        return { result, usage: {}, modelId: resolved.modelId };
    }

    // `jsonMode` guarantees syntactic JSON but not the schema, so it still needs
    // the schema in the prompt to have something to aim at.
    const prompt =
        native === "json-object"
            ? [
                  ...systemMessageFor(resolved.behavior, jsonInstruction(schema, options.name)),
                  ...messages,
              ]
            : messages;

    // `includeRaw` keeps the AIMessage that carries `usage_metadata`; without
    // it LangChain hands back only the parsed object.
    const structured = resolved.chat.withStructuredOutput(schema, {
        name: options.name,
        method: LANGCHAIN_METHOD[native],
        includeRaw: true,
    });
    const modelOptions = signalOptions(options.signal);
    const prepared = applyMessageBehavior(resolved.behavior, prompt);
    const response = modelOptions
        ? await structured.invoke(prepared, modelOptions)
        : await structured.invoke(prepared);
    const usage = normalizeTokenUsage(response.raw);
    if (response.parsed === undefined || response.parsed === null) {
        const detail =
            response.raw === undefined
                ? "no raw response"
                : normalizeModelContent(
                      typeof response.raw === "object" &&
                          response.raw !== null &&
                          "content" in response.raw
                          ? response.raw.content
                          : ""
                  ).slice(0, 300);
        throw new StructuredOutputError(resolved.modelId, `no parsed value (raw: ${detail})`);
    }
    return {
        result: schema.parse(response.parsed),
        usage,
        modelId: resolved.modelId,
    };
}
