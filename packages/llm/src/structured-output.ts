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
import { z } from "zod";
import { zodToJsonSchema, type JsonSchema7Type } from "zod-to-json-schema";
import type { ResolvedChatModel } from "./chat-model-factory";
import { applyMessageBehavior, systemMessageFor } from "./messages";
import { normalizeModelContent } from "./normalize-content";
import type { NativeStructuredOutputMode } from "./types";
import type { ChatTokenUsage } from "./usage";
import { addTokenUsage, normalizeTokenUsage } from "./usage";

export interface StructuredOutputOptions {
    /** Schema/tool name; some endpoints surface it in logs. */
    name: string;
}

/** Raised when the model could not produce a schema-valid result. */
export class StructuredOutputError extends Error {
    override readonly name = "StructuredOutputError";
    readonly modelId: string;

    constructor(modelId: string, cause: string) {
        // The message travels to screens (run histories, answer bubbles), so it
        // never names the model; `modelId` stays on the error for logs.
        super(
            `The model did not return a result matching the requested schema after one repair attempt. Last validation error: ${cause}`
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

/**
 * Parse a model's JSON answer leniently: Markdown fences and a sentence
 * before or after are tolerated. Throws when no JSON value can be recovered.
 */
export function extractJson(text: string): unknown {
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
        const excerpt = withoutFence.slice(0, 160).replace(/\s+/g, " ");
        throw new Error(
            `the response contained no parsable JSON value (${withoutFence.length} chars, starting "${excerpt}")`
        );
    }
}

async function invokeJsonFallback<T>(
    resolved: ResolvedChatModel,
    schema: z.ZodType<T>,
    messages: readonly BaseMessageLike[],
    options: StructuredOutputOptions
): Promise<StructuredResultWithUsage<T>> {
    const instructed = resolved.prepareMessages([
        ...systemMessageFor(resolved.behavior, jsonInstruction(schema, options.name)),
        ...messages,
    ]);

    const first = await resolved.chat.invoke(instructed);
    const firstText = normalizeModelContent(first.content);
    let usage = normalizeTokenUsage(first);

    try {
        return { result: schema.parse(extractJson(firstText)), usage, modelId: resolved.modelId };
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
            const second = await resolved.chat.invoke(repair);
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

/** JSON Schema keywords that bound a size; they drive an endpoint's complexity limit. */
const SIZE_BOUND_KEYWORDS = new Set([
    "minItems",
    "maxItems",
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
]);

/**
 * `const: x` → `enum: [x]`, which means the same. Gemini honours `enum` but
 * not `const`: it returned "founder-weekly-review/v1" for a v2 literal, and the
 * Zod parse refused every weekly review.
 */
function constAsEnum<T>(node: T): T {
    if (Array.isArray(node)) return node.map(constAsEnum) as T;
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === "const" && !("enum" in (node as Record<string, unknown>))) {
            out.enum = [value];
            continue;
        }
        out[key] = constAsEnum(value);
    }
    return out as T;
}

/**
 * Strict JSON Schema requires every fixed property, with null standing in for
 * an omitted optional value. The converter visits nested objects, including
 * union branches, before this postprocessor runs. Open records/catchalls stay
 * open rather than losing their keys; unsupported schemas retain the 400 path.
 */
function strictObjectSchema(node: JsonSchema7Type | undefined): JsonSchema7Type | undefined {
    if (
        !node ||
        !("type" in node) ||
        node.type !== "object" ||
        !("properties" in node) ||
        node.additionalProperties !== false
    ) {
        return node;
    }
    const required = new Set(node.required ?? []);
    for (const [key, property] of Object.entries(node.properties)) {
        if (!required.has(key)) {
            node.properties[key] = { anyOf: [property, { type: "null" }] };
        }
    }
    node.required = Object.keys(node.properties);
    node.additionalProperties = false;
    return node;
}

/**
 * Decode strict-mode null sentinels inside the original Zod validation tree.
 * Preprocessing each optional property lets Zod choose union branches itself,
 * without guessing a branch or running refinements/transforms twice. Required
 * nullable fields, and optional fields that already accept null, keep null.
 * Traverse every container the converter descends into, including catchalls;
 * Map, Set and Promise still require their original non-JSON input types.
 * Copies preserve the original checks, defaults, effects and unknown-key policy.
 * Explicit class generics keep child-schema accessors typed after narrowing.
 */
function withOptionalNullsAsMissing<T>(schema: z.ZodType<T>): z.ZodType<T> {
    const seen = new Map<z.ZodTypeAny, z.ZodTypeAny>();
    const visit = (node: z.ZodTypeAny): z.ZodTypeAny => {
        const cached = seen.get(node);
        if (cached) return cached;
        let result: z.ZodTypeAny = node;
        if (node instanceof z.ZodObject) {
            const object = node as z.ZodObject<z.ZodRawShape, z.UnknownKeysParam, z.ZodTypeAny>;
            const shape: z.ZodRawShape = {};
            for (const [key, property] of Object.entries(object.shape)) {
                const child = visit(property);
                shape[key] =
                    property.isOptional() && !property.isNullable()
                        ? z.preprocess(value => (value === null ? undefined : value), child)
                        : child;
            }
            result = new z.ZodObject({
                ...object._def,
                shape: () => shape,
                catchall: visit(object._def.catchall),
            });
        } else if (node instanceof z.ZodArray) {
            const array = node as z.ZodArray<z.ZodTypeAny, z.ArrayCardinality>;
            result = new z.ZodArray({ ...array._def, type: visit(array.element) });
        } else if (node instanceof z.ZodUnion) {
            const union = node as z.ZodUnion<z.ZodUnionOptions>;
            result = new z.ZodUnion({
                ...union._def,
                options: union.options.map(visit) as [
                    z.ZodTypeAny,
                    z.ZodTypeAny,
                    ...z.ZodTypeAny[],
                ],
            });
        } else if (node instanceof z.ZodDiscriminatedUnion) {
            const union = node as z.ZodDiscriminatedUnion<
                string,
                z.ZodDiscriminatedUnionOption<string>[]
            >;
            // Rebuild the discriminator lookup as well as the option schemas.
            result = z.discriminatedUnion(
                union.discriminator,
                union.options.map(visit) as [
                    z.ZodDiscriminatedUnionOption<string>,
                    ...z.ZodDiscriminatedUnionOption<string>[],
                ],
                union._def
            );
        } else if (node instanceof z.ZodIntersection) {
            const intersection = node as z.ZodIntersection<z.ZodTypeAny, z.ZodTypeAny>;
            result = new z.ZodIntersection({
                ...intersection._def,
                left: visit(intersection._def.left),
                right: visit(intersection._def.right),
            });
        } else if (node instanceof z.ZodTuple) {
            const tuple = node as z.ZodTuple<z.ZodTupleItems | [], z.ZodTypeAny | null>;
            result = new z.ZodTuple({
                ...tuple._def,
                items: tuple.items.map(visit) as z.ZodTupleItems | [],
                rest: tuple._def.rest ? visit(tuple._def.rest) : null,
            });
        } else if (node instanceof z.ZodPipeline) {
            const pipeline = node as z.ZodPipeline<z.ZodTypeAny, z.ZodTypeAny>;
            result = new z.ZodPipeline({
                ...pipeline._def,
                in: visit(pipeline._def.in),
                out: visit(pipeline._def.out),
            });
        } else if (node instanceof z.ZodEffects) {
            const effects = node as z.ZodEffects<z.ZodTypeAny>;
            result = new z.ZodEffects({ ...effects._def, schema: visit(effects.innerType()) });
        } else if (node instanceof z.ZodOptional) {
            const optional = node as z.ZodOptional<z.ZodTypeAny>;
            result = new z.ZodOptional({ ...optional._def, innerType: visit(optional.unwrap()) });
        } else if (node instanceof z.ZodNullable) {
            const nullable = node as z.ZodNullable<z.ZodTypeAny>;
            result = new z.ZodNullable({ ...nullable._def, innerType: visit(nullable.unwrap()) });
        } else if (node instanceof z.ZodDefault) {
            const defaultSchema = node as z.ZodDefault<z.ZodTypeAny>;
            result = new z.ZodDefault({
                ...defaultSchema._def,
                innerType: visit(defaultSchema.removeDefault()),
            });
        } else if (node instanceof z.ZodCatch) {
            const catchSchema = node as z.ZodCatch<z.ZodTypeAny>;
            result = new z.ZodCatch({
                ...catchSchema._def,
                innerType: visit(catchSchema.removeCatch()),
            });
        } else if (node instanceof z.ZodBranded) {
            const branded = node as z.ZodBranded<z.ZodTypeAny, string | number | symbol>;
            result = new z.ZodBranded({ ...branded._def, type: visit(branded.unwrap()) });
        } else if (node instanceof z.ZodReadonly) {
            const readonly = node as z.ZodReadonly<z.ZodTypeAny>;
            result = new z.ZodReadonly({ ...readonly._def, innerType: visit(readonly.unwrap()) });
        } else if (node instanceof z.ZodPromise) {
            const promise = node as z.ZodPromise<z.ZodTypeAny>;
            result = new z.ZodPromise({ ...promise._def, type: visit(promise.unwrap()) });
        } else if (node instanceof z.ZodLazy) {
            const lazy = node as z.ZodLazy<z.ZodTypeAny>;
            result = new z.ZodLazy({ ...lazy._def, getter: () => visit(lazy.schema) });
        } else if (node instanceof z.ZodRecord) {
            const record = node as z.ZodRecord<z.KeySchema, z.ZodTypeAny>;
            result = new z.ZodRecord({ ...record._def, valueType: visit(record.valueSchema) });
        } else if (node instanceof z.ZodMap) {
            const map = node as z.ZodMap<z.ZodTypeAny, z.ZodTypeAny>;
            result = new z.ZodMap({
                ...map._def,
                keyType: visit(map.keySchema),
                valueType: visit(map.valueSchema),
            });
        } else if (node instanceof z.ZodSet) {
            const set = node as z.ZodSet<z.ZodTypeAny>;
            result = new z.ZodSet({ ...set._def, valueType: visit(set._def.valueType) });
        }
        seen.set(node, result);
        return result;
    };
    return visit(schema) as z.ZodType<T>;
}

function withoutSizeBounds(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(withoutSizeBounds);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        // A property may itself be named "maximum"; only strip keyword positions.
        if (SIZE_BOUND_KEYWORDS.has(key) && typeof value === "number") continue;
        out[key] = withoutSizeBounds(value);
    }
    return out;
}

function statusOf(error: unknown): number | undefined {
    const status = (error as { status?: unknown } | null)?.status;
    return typeof status === "number" ? status : undefined;
}

const refusedSchemas = new Set<string>();

const warnedIgnoredStructure = new Set<string>();

function warnStructureIgnoredOnce(modelId: string, name: string): void {
    const key = `${modelId}:${name}`;
    if (warnedIgnoredStructure.has(key)) return;
    warnedIgnoredStructure.add(key);
    console.warn(
        `[structured-output] ${modelId} answered "${name}" without the requested structure; ` +
            "using the prompt-based JSON path for it."
    );
}

function warnSchemaRefusedOnce(modelId: string, name: string): void {
    const key = `${modelId}:${name}`;
    if (refusedSchemas.has(key)) return;
    refusedSchemas.add(key);
    console.warn(
        `[structured-output] ${modelId} refused the "${name}" JSON schema (HTTP 400); ` +
            "using the prompt-based JSON path for it."
    );
}

/** A structured result plus what it cost — the meterable envelope. */
export interface StructuredResultWithUsage<T> {
    result: T;
    usage: ChatTokenUsage;
    modelId: string;
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
    options: StructuredOutputOptions
): Promise<T> {
    return (await invokeStructuredWithUsage(resolved, schema, messages, options)).result;
}

/**
 * `invokeStructured`, keeping the response envelope: token usage (summed
 * across the repair attempt when one happens) and the serving model id.
 * Additive fix from the rebuild design (§3.8 P1 prerequisite) — before this,
 * the envelope was discarded and no tool's LLM call could be metered.
 */
export async function invokeStructuredWithUsage<T>(
    resolved: ResolvedChatModel,
    schema: z.ZodType<T>,
    messages: readonly BaseMessageLike[],
    options: StructuredOutputOptions
): Promise<StructuredResultWithUsage<T>> {
    const native = pickNativeStructuredMode(resolved.behavior.nativeStructuredOutput);
    if (!native) {
        return invokeJsonFallback(resolved, schema, messages, options);
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
    // Only json-schema mode requests strict endpoint enforcement. It receives
    // a plain schema so OpenAI's Zod helper cannot reject optional fields before
    // we make them required/nullable; the Zod parse still enforces their contract.
    const invokeNative = (endpointSchema: z.ZodType<unknown> | Record<string, unknown>) =>
        resolved.chat
            .withStructuredOutput(endpointSchema, {
                name: options.name,
                method: LANGCHAIN_METHOD[native],
                includeRaw: true,
                ...(native === "json-schema" ? { strict: true } : {}),
            })
            .invoke(applyMessageBehavior(resolved.behavior, prompt));

    let response: Awaited<ReturnType<typeof invokeNative>>;
    if (native !== "json-schema") {
        response = await invokeNative(schema);
    } else {
        // Close fixed object shapes and encode optional values as required,
        // nullable properties for strict endpoints. Keep constAsEnum for Gemini.
        const jsonSchema = constAsEnum(
            zodToJsonSchema(schema, {
                $refStrategy: "none",
                postProcess: strictObjectSchema,
            })
        );
        try {
            response = await invokeNative(jsonSchema);
        } catch (error) {
            if (statusOf(error) !== 400) throw error;
            // Endpoints take a subset of JSON Schema and refuse one they judge
            // too complex with a bare 400 — Gemini rejects the founder weekly
            // review's anyOf + maxItems, and accepts it once the size bounds
            // are gone. The bounds still hold: Zod checks them below. A 400
            // that is not about the schema (a bad key) fails the prompt path
            // too, so nothing is masked.
            warnSchemaRefusedOnce(resolved.modelId, options.name);
            try {
                response = await invokeNative(
                    withoutSizeBounds(jsonSchema) as Record<string, unknown>
                );
            } catch (relaxedError) {
                if (statusOf(relaxedError) !== 400) throw relaxedError;
                return invokeJsonFallback(resolved, schema, messages, options);
            }
        }
    }
    const usage = normalizeTokenUsage(response.raw);
    if (response.parsed === undefined || response.parsed === null) {
        // The endpoint accepted the request but answered without the structure
        // it was asked for: some compatible servers silently ignore
        // `response_format`. The model never saw the schema then, so ask again
        // the way models without native support are asked.
        warnStructureIgnoredOnce(resolved.modelId, options.name);
        const fallback = await invokeJsonFallback(resolved, schema, messages, options);
        return { ...fallback, usage: addTokenUsage(usage, fallback.usage) };
    }
    return {
        result:
            native === "json-schema"
                ? withOptionalNullsAsMissing(schema).parse(response.parsed)
                : schema.parse(response.parsed),
        usage,
        modelId: resolved.modelId,
    };
}
