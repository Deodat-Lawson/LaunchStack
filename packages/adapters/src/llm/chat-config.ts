/**
 * Parsing and validation for the chat model configuration file.
 *
 * The file carries only non-secret data: which model ids exist, how each one
 * behaves, and which route each serves. The endpoint URL and its credential
 * stay in the environment and are joined in here at build time.
 *
 * Validation is deliberately strict and happens once, at startup: a mistyped
 * reasoning mode or a `vision` route pointed at a text-only model should stop
 * the deployment, not surface as a confusing 500 on someone's first upload.
 */

import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { getChatModelPreset, listChatModelPresetNames } from "./presets";
import {
    ChatConfigurationError,
    ChatRoutes,
    behaviorSupportsReasoning,
    behaviorSupportsVision,
    type ChatEndpointConfig,
    type ChatModelBehavior,
    type ChatModelDefinition,
    type ChatReasoningBehavior,
    type ChatRequestPatch,
    type ChatRoute,
} from "./types";

/** Schema versions this build understands. */
export const SUPPORTED_CHAT_CONFIG_VERSIONS = [1] as const;

/**
 * Request-body fields a reasoning patch may never write. These carry the
 * request's identity, its transport, or its credentials — letting a patch
 * reach them would turn a "how hard should it think" setting into arbitrary
 * request rewriting.
 */
export const RESERVED_REQUEST_FIELDS: readonly string[] = [
    "model",
    "messages",
    "stream",
    "stream_options",
    "api_key",
    "apikey",
    "authorization",
    "headers",
    "base_url",
    "baseurl",
    "url",
    "n",
];

const reservedFieldSet = new Set(RESERVED_REQUEST_FIELDS);

function assertPatchFieldsAllowed(
    patch: ChatRequestPatch,
    where: string,
    ctx: z.RefinementCtx
): void {
    for (const key of Object.keys(patch)) {
        if (reservedFieldSet.has(key.toLowerCase())) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `${where} may not set the reserved request field "${key}".`,
            });
        }
    }
}

const requestPatchSchema = z.record(z.unknown()).superRefine((patch, ctx) => {
    assertPatchFieldsAllowed(patch, "A reasoning request patch", ctx);
});

// Members stay plain objects so `discriminatedUnion` can index them; the
// cross-field rules run as one refinement on the union.
const reasoningUnion = z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("none") }).strict(),
    z.object({ mode: z.literal("always"), request: requestPatchSchema.optional() }).strict(),
    z
        .object({
            mode: z.literal("toggle"),
            on: requestPatchSchema,
            off: requestPatchSchema.optional(),
        })
        .strict(),
    z
        .object({
            mode: z.literal("effort"),
            levels: z.record(requestPatchSchema),
            default: z.string().min(1),
            off: requestPatchSchema.optional(),
        })
        .strict(),
    z
        .object({
            mode: z.literal("budget"),
            field: z.string().min(1),
            default: z.number().int().nonnegative(),
            min: z.number().int().nonnegative(),
            max: z.number().int().positive(),
            off: requestPatchSchema.optional(),
        })
        .strict(),
]);

const reasoningSchema = reasoningUnion.superRefine((value, ctx) => {
    if (value.mode === "effort") {
        const levels = Object.keys(value.levels);
        if (levels.length === 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["levels"],
                message: 'Reasoning mode "effort" needs at least one level.',
            });
            return;
        }
        if (!Object.hasOwn(value.levels, value.default)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["default"],
                message: `Default effort "${value.default}" is not one of the declared levels (${levels.join(", ")}).`,
            });
        }
        return;
    }
    if (value.mode === "budget") {
        if (reservedFieldSet.has(value.field.toLowerCase())) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["field"],
                message: `A reasoning budget may not be written to the reserved request field "${value.field}".`,
            });
        }
        if (value.min > value.max) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["min"],
                message: "Reasoning budget min must not exceed max.",
            });
        }
        if (value.default < value.min || value.default > value.max) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["default"],
                message: "Reasoning budget default must fall between min and max.",
            });
        }
    }
}) as unknown as z.ZodType<ChatReasoningBehavior>;

const parameterSupportSchema = z.enum(["supported", "unsupported"]);

const imageLimitsSchema = z
    .object({
        mimeTypes: z.array(z.string().min(1)).nonempty().optional(),
        maxImages: z.number().int().positive().optional(),
    })
    .strict();

const limitsSchema = z
    .object({
        contextTokens: z.number().int().positive().optional(),
        maxOutputTokens: z.number().int().positive().optional(),
    })
    .strict();

const parametersObjectSchema = z
    .object({
        temperature: parameterSupportSchema,
        systemMessages: parameterSupportSchema,
        streaming: parameterSupportSchema,
        maxOutputTokens: parameterSupportSchema,
        maxOutputTokensField: z.string().min(1).optional(),
    })
    .strict();

function refineParameters(value: { maxOutputTokensField?: string }, ctx: z.RefinementCtx): void {
    if (
        value.maxOutputTokensField &&
        reservedFieldSet.has(value.maxOutputTokensField.toLowerCase())
    ) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["maxOutputTokensField"],
            message: `The output-token cap may not be written to the reserved request field "${value.maxOutputTokensField}".`,
        });
    }
}

const parametersSchema = parametersObjectSchema.superRefine(refineParameters);
const partialParametersSchema = parametersObjectSchema.partial().superRefine(refineParameters);

/** Complete declaration — required for any model without a preset. */
const fullBehaviorSchema = z
    .object({
        input: z.array(z.enum(["text", "image"])).nonempty(),
        image: imageLimitsSchema.optional(),
        reasoning: reasoningSchema,
        nativeStructuredOutput: z.array(z.enum(["json-object", "json-schema", "tool-calling"])),
        parameters: parametersSchema,
        limits: limitsSchema.optional(),
    })
    .strict();

/** Overlay on top of a preset. Every key present replaces the preset's. */
const behaviorOverrideSchema = z
    .object({
        input: z
            .array(z.enum(["text", "image"]))
            .nonempty()
            .optional(),
        image: imageLimitsSchema.optional(),
        reasoning: reasoningSchema.optional(),
        nativeStructuredOutput: z
            .array(z.enum(["json-object", "json-schema", "tool-calling"]))
            .optional(),
        parameters: partialParametersSchema.optional(),
        limits: limitsSchema.optional(),
    })
    .strict();

const modelSchema = z
    .object({
        id: z.string().min(1),
        preset: z.string().min(1).optional(),
        behavior: z.unknown().optional(),
    })
    .strict();

const routesSchema = z
    .object({
        default: z.string().min(1),
        fast: z.string().min(1).optional(),
        reasoning: z.string().min(1).optional(),
        vision: z.string().min(1).optional(),
    })
    .strict();

const fileSchema = z
    .object({
        version: z.number().int(),
        models: z.record(z.string().min(1), modelSchema),
        routes: routesSchema,
    })
    .strict();

export type ChatModelsFile = z.infer<typeof fileSchema>;

/** Runtime configuration: the endpoint plus every resolved model and route. */
export interface ChatModelsConfig {
    readonly version: number;
    readonly endpoint: ChatEndpointConfig;
    readonly models: ReadonlyMap<string, ChatModelDefinition>;
    /**
     * Model name serving each route. `default` is always present; a specialized
     * route is undefined when the operator did not assign one, in which case it
     * may inherit `default` if that model has the capability.
     */
    readonly routes: Readonly<Record<ChatRoute, string | undefined>> & {
        readonly default: string;
    };
}

function formatZodError(error: z.ZodError, file: string): string {
    const issues = error.issues
        .map(issue => {
            const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
            return `  - ${path}: ${issue.message}`;
        })
        .join("\n");
    return `${file} is not a valid chat model configuration:\n${issues}`;
}

function mergeBehavior(
    presetBehavior: ChatModelBehavior,
    override: z.infer<typeof behaviorOverrideSchema> | undefined
): unknown {
    if (!override) return presetBehavior;
    return {
        ...presetBehavior,
        ...(override.input ? { input: override.input } : {}),
        ...(override.image ? { image: override.image } : {}),
        ...(override.reasoning ? { reasoning: override.reasoning } : {}),
        ...(override.nativeStructuredOutput
            ? { nativeStructuredOutput: override.nativeStructuredOutput }
            : {}),
        ...(override.limits ? { limits: override.limits } : {}),
        parameters: { ...presetBehavior.parameters, ...(override.parameters ?? {}) },
    };
}

function resolveModelBehavior(
    name: string,
    model: z.infer<typeof modelSchema>,
    file: string
): { behavior: ChatModelBehavior; preset?: string } {
    if (model.preset) {
        const preset = getChatModelPreset(model.preset);
        if (!preset) {
            throw new ChatConfigurationError(
                `${file}: model "${name}" references unknown preset "${model.preset}". ` +
                    `Available presets: ${listChatModelPresetNames().join(", ")}.`
            );
        }
        const override = behaviorOverrideSchema.safeParse(model.behavior ?? {});
        if (!override.success) {
            throw new ChatConfigurationError(
                formatZodError(override.error, `${file} (models.${name}.behavior)`)
            );
        }
        const merged = fullBehaviorSchema.safeParse(mergeBehavior(preset.behavior, override.data));
        if (!merged.success) {
            throw new ChatConfigurationError(
                formatZodError(merged.error, `${file} (models.${name}.behavior)`)
            );
        }
        return { behavior: merged.data as ChatModelBehavior, preset: model.preset };
    }

    if (model.behavior === undefined) {
        throw new ChatConfigurationError(
            `${file}: model "${name}" must either reference a preset or declare a complete behavior. ` +
                `Behavior is never inferred from the model id.`
        );
    }
    const parsed = fullBehaviorSchema.safeParse(model.behavior);
    if (!parsed.success) {
        throw new ChatConfigurationError(
            formatZodError(parsed.error, `${file} (models.${name}.behavior)`)
        );
    }
    return { behavior: parsed.data as ChatModelBehavior };
}

function assertRouteCapability(
    route: Extract<ChatRoute, "reasoning" | "vision">,
    definition: ChatModelDefinition,
    modelName: string,
    file: string
): void {
    const supported =
        route === "vision"
            ? behaviorSupportsVision(definition.behavior)
            : behaviorSupportsReasoning(definition.behavior);
    if (supported) return;
    throw new ChatConfigurationError(
        `${file}: the "${route}" route is assigned to model "${modelName}" (${definition.id}), ` +
            `which does not declare ${route === "vision" ? "image input" : "a reasoning mode"}. ` +
            `Assign a capable model or remove the route so it can fall back to "default".`
    );
}

export interface BuildChatModelsConfigInput {
    /** Structural configuration, already parsed from YAML. */
    file: unknown;
    /** Endpoint and credential, always from the environment. */
    endpoint: ChatEndpointConfig;
    /** Path or label used in error messages. */
    sourceLabel?: string;
}

/**
 * Validate a parsed configuration document and join it to the endpoint.
 * Throws {@link ChatConfigurationError} on anything wrong, so callers can let
 * it propagate and fail startup.
 */
export function buildChatModelsConfig(input: BuildChatModelsConfigInput): ChatModelsConfig {
    const label = input.sourceLabel ?? "chat model configuration";

    if (!input.endpoint.baseUrl || input.endpoint.baseUrl.trim().length === 0) {
        throw new ChatConfigurationError(
            "CHAT_BASE_URL is required: it is the OpenAI-compatible endpoint every route talks to."
        );
    }

    const parsed = fileSchema.safeParse(input.file);
    if (!parsed.success) {
        throw new ChatConfigurationError(formatZodError(parsed.error, label));
    }
    const file = parsed.data;

    if (!(SUPPORTED_CHAT_CONFIG_VERSIONS as readonly number[]).includes(file.version)) {
        throw new ChatConfigurationError(
            `${label}: unsupported schema version ${file.version}. ` +
                `This build understands version ${SUPPORTED_CHAT_CONFIG_VERSIONS.join(", ")}.`
        );
    }

    const models = new Map<string, ChatModelDefinition>();
    for (const [name, model] of Object.entries(file.models)) {
        const { behavior, preset } = resolveModelBehavior(name, model, label);
        models.set(name, { id: model.id, behavior, ...(preset ? { preset } : {}) });
    }

    for (const route of ChatRoutes) {
        const assigned = file.routes[route];
        if (assigned === undefined) continue;
        if (!models.has(assigned)) {
            throw new ChatConfigurationError(
                `${label}: route "${route}" references model "${assigned}", which is not declared under models.`
            );
        }
    }

    // Explicit specialized routes fail startup rather than a later request.
    for (const route of ["reasoning", "vision"] as const) {
        const assigned = file.routes[route];
        if (assigned === undefined) continue;
        assertRouteCapability(route, models.get(assigned)!, assigned, label);
    }

    return {
        version: file.version,
        endpoint: {
            baseUrl: input.endpoint.baseUrl.trim(),
            ...(input.endpoint.apiKey && input.endpoint.apiKey.trim().length > 0
                ? { apiKey: input.endpoint.apiKey.trim() }
                : {}),
        },
        models,
        routes: {
            default: file.routes.default,
            fast: file.routes.fast,
            reasoning: file.routes.reasoning,
            vision: file.routes.vision,
        },
    };
}

/** Parse YAML text into an unvalidated document. */
export function parseChatModelsYaml(
    text: string,
    sourceLabel = "chat model configuration"
): unknown {
    try {
        return parseYaml(text) as unknown;
    } catch (error) {
        throw new ChatConfigurationError(
            `${sourceLabel} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

/** Convenience wrapper: YAML text + endpoint → validated runtime config. */
export function createChatModelsConfig(input: {
    yaml: string;
    endpoint: ChatEndpointConfig;
    sourceLabel?: string;
}): ChatModelsConfig {
    return buildChatModelsConfig({
        file: parseChatModelsYaml(input.yaml, input.sourceLabel),
        endpoint: input.endpoint,
        sourceLabel: input.sourceLabel,
    });
}
