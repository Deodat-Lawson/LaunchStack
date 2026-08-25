/**
 * Locally bundled catalog of verified model behaviors.
 *
 * A preset is a shortcut, never an inference: configuration referencing
 * `preset: openai/gpt-4o` gets that entry's declared behavior, and a model id
 * that merely *looks* like a known one gets nothing. Substring matching on
 * model ids is exactly the guessing this architecture exists to avoid.
 *
 * Every entry records where the behavior came from and when it was last
 * checked, so a stale claim is visible rather than silently authoritative.
 * Operator YAML overrides win in both directions — including turning off a
 * capability a preset claims.
 *
 * Behaviors describe the model **as reached over the plain OpenAI-compatible
 * chat-completions protocol**. A gateway that rewrites request fields is a
 * different contract; declare that model explicitly instead.
 *
 * Contributing: add an entry with a first-party source URL, set `verifiedOn`
 * to the date you checked it, and cover it in
 * `packages/core/src/llm/__tests__` or the app-level preset test.
 */

import type { ChatModelBehavior } from "./types";

/** Bumped when the catalog's *shape* changes, not when entries are edited. */
export const PRESET_CATALOG_VERSION = 1;

export interface ChatModelPreset {
    /** Stable catalog key referenced from YAML. */
    readonly name: string;
    /** First-party documentation the behavior was read from. */
    readonly source: string;
    /** ISO date the entry was last checked against that source. */
    readonly verifiedOn: string;
    /** Anything an operator should know before adopting the entry verbatim. */
    readonly notes?: string;
    readonly behavior: ChatModelBehavior;
}

const OPENAI_MODELS_DOC = "https://platform.openai.com/docs/models";
const OPENAI_REASONING_DOC = "https://platform.openai.com/docs/guides/reasoning";
const GOOGLE_OPENAI_COMPAT_DOC = "https://ai.google.dev/gemini-api/docs/openai";
const OPENAI_CHAT_SPEC = "https://platform.openai.com/docs/api-reference/chat/create";

/** Effort levels the OpenAI reasoning family exposes via `reasoning_effort`. */
const OPENAI_REASONING_EFFORT = {
    mode: "effort",
    levels: {
        minimal: { reasoning_effort: "minimal" },
        low: { reasoning_effort: "low" },
        medium: { reasoning_effort: "medium" },
        high: { reasoning_effort: "high" },
    },
    default: "medium",
} as const;

const OPENAI_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

const PRESETS: readonly ChatModelPreset[] = [
    {
        name: "google/gemini-2.5-flash",
        source: GOOGLE_OPENAI_COMPAT_DOC,
        verifiedOn: "2026-05-01",
        notes:
            "Behavior via Google's OpenAI-compatibility endpoint " +
            "(https://generativelanguage.googleapis.com/v1beta/openai/), not the " +
            "native Gemini API.",
        behavior: {
            input: ["text", "image"],
            image: {
                mimeTypes: ["image/png", "image/jpeg", "image/webp", "image/heic"],
            },
            reasoning: {
                mode: "effort",
                levels: {
                    none: { reasoning_effort: "none" },
                    low: { reasoning_effort: "low" },
                    medium: { reasoning_effort: "medium" },
                    high: { reasoning_effort: "high" },
                },
                default: "medium",
            },
            nativeStructuredOutput: ["json-object", "json-schema", "tool-calling"],
            parameters: {
                temperature: "supported",
                systemMessages: "supported",
                streaming: "supported",
                maxOutputTokens: "supported",
            },
        },
    },
    {
        name: "google/gemini-2.5-flash-lite",
        source: GOOGLE_OPENAI_COMPAT_DOC,
        verifiedOn: "2026-05-01",
        notes:
            "The cheap tier, for the `fast` route. Behavior is asserted from the " +
            "2.5 family's shared OpenAI-compatibility surface — it was NOT " +
            "independently re-verified against a per-model reference on the date " +
            "above. Confirm against your endpoint before relying on the reasoning " +
            "levels in particular; an over-claimed capability surfaces as a " +
            "confusing runtime error, so prefer overriding `behavior` in your " +
            "configuration file if a request is rejected.",
        behavior: {
            input: ["text", "image"],
            image: {
                mimeTypes: ["image/png", "image/jpeg", "image/webp", "image/heic"],
            },
            reasoning: {
                mode: "effort",
                levels: {
                    none: { reasoning_effort: "none" },
                    low: { reasoning_effort: "low" },
                    medium: { reasoning_effort: "medium" },
                    high: { reasoning_effort: "high" },
                },
                default: "none",
            },
            nativeStructuredOutput: ["json-object", "json-schema", "tool-calling"],
            parameters: {
                temperature: "supported",
                systemMessages: "supported",
                streaming: "supported",
                maxOutputTokens: "supported",
            },
        },
    },
    {
        name: "google/gemini-2.5-pro",
        source: GOOGLE_OPENAI_COMPAT_DOC,
        verifiedOn: "2026-05-01",
        notes:
            "The reasoning tier, for the `reasoning` route. Same caveat as " +
            "google/gemini-2.5-flash-lite: behavior is asserted from the 2.5 " +
            "family's shared compatibility surface, not independently re-verified " +
            "per model. Note `none` is deliberately absent — 2.5 Pro always " +
            "reasons and rejects an attempt to disable it.",
        behavior: {
            input: ["text", "image"],
            image: {
                mimeTypes: ["image/png", "image/jpeg", "image/webp", "image/heic"],
            },
            reasoning: {
                mode: "effort",
                levels: {
                    low: { reasoning_effort: "low" },
                    medium: { reasoning_effort: "medium" },
                    high: { reasoning_effort: "high" },
                },
                default: "medium",
            },
            nativeStructuredOutput: ["json-object", "json-schema", "tool-calling"],
            parameters: {
                temperature: "supported",
                systemMessages: "supported",
                streaming: "supported",
                maxOutputTokens: "supported",
            },
        },
    },
    {
        name: "openai/gpt-4o",
        source: OPENAI_MODELS_DOC,
        verifiedOn: "2026-05-01",
        behavior: {
            input: ["text", "image"],
            image: { mimeTypes: OPENAI_IMAGE_MIME_TYPES },
            reasoning: { mode: "none" },
            nativeStructuredOutput: ["json-object", "json-schema", "tool-calling"],
            parameters: {
                temperature: "supported",
                systemMessages: "supported",
                streaming: "supported",
                maxOutputTokens: "supported",
            },
            limits: { contextTokens: 128_000, maxOutputTokens: 16_384 },
        },
    },
    {
        name: "openai/gpt-4o-mini",
        source: OPENAI_MODELS_DOC,
        verifiedOn: "2026-05-01",
        behavior: {
            input: ["text", "image"],
            image: { mimeTypes: OPENAI_IMAGE_MIME_TYPES },
            reasoning: { mode: "none" },
            nativeStructuredOutput: ["json-object", "json-schema", "tool-calling"],
            parameters: {
                temperature: "supported",
                systemMessages: "supported",
                streaming: "supported",
                maxOutputTokens: "supported",
            },
            limits: { contextTokens: 128_000, maxOutputTokens: 16_384 },
        },
    },
    {
        name: "openai/gpt-5.1",
        source: OPENAI_REASONING_DOC,
        verifiedOn: "2026-05-01",
        notes:
            "Reasoning family: rejects `temperature` and requires " +
            "`max_completion_tokens` rather than `max_tokens`.",
        behavior: {
            input: ["text", "image"],
            image: { mimeTypes: OPENAI_IMAGE_MIME_TYPES },
            reasoning: OPENAI_REASONING_EFFORT,
            nativeStructuredOutput: ["json-object", "json-schema", "tool-calling"],
            parameters: {
                temperature: "unsupported",
                systemMessages: "supported",
                streaming: "supported",
                maxOutputTokens: "supported",
                maxOutputTokensField: "max_completion_tokens",
            },
        },
    },
    {
        name: "openai/gpt-5-mini",
        source: OPENAI_REASONING_DOC,
        verifiedOn: "2026-05-01",
        notes:
            "Reasoning family: rejects `temperature` and requires " +
            "`max_completion_tokens` rather than `max_tokens`.",
        behavior: {
            input: ["text", "image"],
            image: { mimeTypes: OPENAI_IMAGE_MIME_TYPES },
            reasoning: OPENAI_REASONING_EFFORT,
            nativeStructuredOutput: ["json-object", "json-schema", "tool-calling"],
            parameters: {
                temperature: "unsupported",
                systemMessages: "supported",
                streaming: "supported",
                maxOutputTokens: "supported",
                maxOutputTokensField: "max_completion_tokens",
            },
        },
    },
    {
        name: "openai/gpt-5-nano",
        source: OPENAI_REASONING_DOC,
        verifiedOn: "2026-05-01",
        notes:
            "Reasoning family: rejects `temperature` and requires " +
            "`max_completion_tokens` rather than `max_tokens`.",
        behavior: {
            input: ["text", "image"],
            image: { mimeTypes: OPENAI_IMAGE_MIME_TYPES },
            reasoning: OPENAI_REASONING_EFFORT,
            nativeStructuredOutput: ["json-object", "json-schema", "tool-calling"],
            parameters: {
                temperature: "unsupported",
                systemMessages: "supported",
                streaming: "supported",
                maxOutputTokens: "supported",
                maxOutputTokensField: "max_completion_tokens",
            },
        },
    },
    {
        name: "generic/openai-compatible-text",
        source: OPENAI_CHAT_SPEC,
        verifiedOn: "2026-05-01",
        notes:
            "Deliberately minimal: assumes only what every OpenAI-compatible " +
            "chat-completions implementation must accept. Safe starting point for " +
            "a local or self-hosted text model; add capabilities you have verified.",
        behavior: {
            input: ["text"],
            reasoning: { mode: "none" },
            nativeStructuredOutput: [],
            parameters: {
                temperature: "supported",
                systemMessages: "supported",
                streaming: "supported",
                maxOutputTokens: "supported",
            },
        },
    },
];

const PRESETS_BY_NAME: ReadonlyMap<string, ChatModelPreset> = new Map(
    PRESETS.map(preset => [preset.name, preset])
);

export function listChatModelPresets(): readonly ChatModelPreset[] {
    return PRESETS;
}

export function getChatModelPreset(name: string): ChatModelPreset | undefined {
    return PRESETS_BY_NAME.get(name);
}

export function listChatModelPresetNames(): readonly string[] {
    return PRESETS.map(preset => preset.name);
}
