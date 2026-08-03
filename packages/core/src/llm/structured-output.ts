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
import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ResolvedChatModel } from "./chat-model-factory";
import { applyMessageBehavior, systemMessageFor } from "./messages";
import { normalizeModelContent } from "./normalize-content";
import type { NativeStructuredOutputMode } from "./types";

export interface StructuredOutputOptions {
  /** Schema/tool name; some endpoints surface it in logs. */
  name: string;
}

/** Raised when the model could not produce a schema-valid result. */
export class StructuredOutputError extends Error {
  override readonly name = "StructuredOutputError";
  readonly modelId: string;

  constructor(modelId: string, cause: string) {
    super(
      `Model "${modelId}" did not return a result matching the requested schema after one repair attempt. Last validation error: ${cause}`,
    );
    this.modelId = modelId;
  }
}

/** Native mechanism to use, in descending order of schema enforcement. */
export function pickNativeStructuredMode(
  declared: readonly NativeStructuredOutputMode[],
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

async function invokeJsonFallback<T>(
  resolved: ResolvedChatModel,
  schema: z.ZodType<T>,
  messages: readonly BaseMessageLike[],
  options: StructuredOutputOptions,
): Promise<T> {
  const instructed = resolved.prepareMessages([
    ...systemMessageFor(resolved.behavior, jsonInstruction(schema, options.name)),
    ...messages,
  ]);

  const first = await resolved.chat.invoke(instructed);
  const firstText = normalizeModelContent(first.content);

  try {
    return schema.parse(extractJson(firstText));
  } catch (firstError) {
    const issue =
      firstError instanceof Error ? firstError.message : String(firstError);
    const repair = applyMessageBehavior(resolved.behavior, [
      ...instructed,
      new HumanMessage(
        `Your previous response was invalid. Validation error:\n${issue}\n\n` +
          `Previous response:\n${firstText}\n\nReturn a corrected JSON value only.`,
      ),
    ]);

    try {
      const second = await resolved.chat.invoke(repair);
      return schema.parse(extractJson(normalizeModelContent(second.content)));
    } catch (repairError) {
      throw new StructuredOutputError(
        resolved.modelId,
        repairError instanceof Error ? repairError.message : String(repairError),
      );
    }
  }
}

/**
 * Invoke a resolved chat model and validate the result against `schema`.
 * Works for every configured model; the mechanism depends on what the model
 * declares, never on its id.
 */
export async function invokeStructured<T>(
  resolved: ResolvedChatModel,
  schema: z.ZodType<T>,
  messages: readonly BaseMessageLike[],
  options: StructuredOutputOptions,
): Promise<T> {
  const native = pickNativeStructuredMode(
    resolved.behavior.nativeStructuredOutput,
  );
  if (!native) {
    return invokeJsonFallback(resolved, schema, messages, options);
  }

  // `jsonMode` guarantees syntactic JSON but not the schema, so it still needs
  // the schema in the prompt to have something to aim at.
  const prompt =
    native === "json-object"
      ? [
          ...systemMessageFor(
            resolved.behavior,
            jsonInstruction(schema, options.name),
          ),
          ...messages,
        ]
      : messages;

  const structured = resolved.chat.withStructuredOutput(schema, {
    name: options.name,
    method: LANGCHAIN_METHOD[native],
  });
  return schema.parse(
    await structured.invoke(applyMessageBehavior(resolved.behavior, prompt)),
  );
}
