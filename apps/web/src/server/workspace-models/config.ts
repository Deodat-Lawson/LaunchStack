/**
 * Turning a workspace's saved model choices into a chat configuration.
 *
 * Pure: no database, no network, no environment. The scope loader feeds it a
 * decrypted row; tests feed it literals.
 *
 * Behavior is what the admin declared, never inferred from the model id — the
 * same rule the deployment's configuration file follows (see the header of
 * `packages/llm/src/presets.ts`). The admin says whether a model reads images
 * and whether it reasons; everything else is the most conservative contract
 * every OpenAI-compatible server accepts, because nobody has verified more:
 *
 * - no `temperature` (Claude's compatibility layer and reasoning models reject
 *   values the app sends),
 * - no output-token cap (OpenAI's reasoning models reject `max_tokens`, and a
 *   cap that counts reasoning tokens can leave an answer empty),
 * - structured output by JSON prompting, unless the admin says the model
 *   follows a JSON schema (`response_format: json_schema`).
 */

import {
    ChatConfigurationError,
    buildChatModelsConfig,
    type ChatModelPricing,
    type ChatModelsConfig,
    type ChatRoute,
} from "@launchstack/llm";

import { ASSISTANT_IDENTITY_RULE } from "~/lib/ai/assistant-identity";
import {
    MAX_OFFERED_LABEL_CHARS,
    MAX_OFFERED_MODELS,
    isModelKey,
} from "~/lib/ai/model-picks";
import { MAX_PRICE_TEXT, isPlausiblePrice } from "~/lib/ai/model-pricing";
import type {
    WorkspaceModelChoice,
    WorkspaceModelSelection,
    WorkspaceOfferedModel,
} from "~/server/db/schema/workspace-models";

/** The routes a workspace can assign, in the order Settings lists them. */
export const WORKSPACE_MODEL_ROUTES = ["default", "fast", "reasoning", "vision"] as const;

/**
 * The configuration's name for an offered model. Route models are named after
 * their route (`default`, `fast`, …), so the two never collide.
 */
export function offeredModelName(key: string): string {
    return `offered:${key}`;
}

/** Model ids are opaque to us, but an id with whitespace or a 300-char paste is a typo. */
const MODEL_ID_PATTERN = /^[^\s]{1,200}$/;

export function isPlausibleModelId(id: string): boolean {
    return MODEL_ID_PATTERN.test(id);
}

/** The declared behavior for one model, from the admin's two answers. */
export function behaviorForChoice(choice: WorkspaceModelChoice) {
    return {
        input: choice.vision ? (["text", "image"] as const) : (["text"] as const),
        reasoning: choice.reasoning ? { mode: "always" as const } : { mode: "none" as const },
        // Declared by the admin. The json-schema path already falls back to
        // JSON prompting when an endpoint refuses the schema (400) or ignores
        // it (no parsed value), so an over-claim costs a retry, not a failure.
        nativeStructuredOutput: choice.structuredOutput
            ? (["json-schema"] as "json-schema"[])
            : ([] as "json-schema"[]),
        parameters: {
            temperature: "unsupported" as const,
            systemMessages: "supported" as const,
            streaming: "supported" as const,
            maxOutputTokens: "unsupported" as const,
        },
    };
}

/**
 * The configuration-file document a selection stands for. A price the admin
 * gave goes onto the model's definition, where the chat transport prices each
 * call from it (`costUsd`), as it does for the deployment's own models.
 */
export function workspaceModelsFile(selection: WorkspaceModelSelection) {
    const models: Record<
        string,
        {
            id: string;
            behavior: ReturnType<typeof behaviorForChoice>;
            pricing?: ChatModelPricing;
        }
    > = {};
    const routes: Partial<Record<ChatRoute, string>> = {};
    for (const route of WORKSPACE_MODEL_ROUTES) {
        const choice = selection[route];
        if (!choice) continue;
        // Only the fields the file takes, whatever else the stored row carries.
        const pricing = usablePrice(choice.pricing);
        models[route] = {
            id: choice.id.trim(),
            behavior: behaviorForChoice(choice),
            ...(pricing ? { pricing } : {}),
        };
        routes[route] = route;
    }
    for (const offered of selection.offered ?? []) {
        const pricing = usablePrice(offered.pricing);
        models[offeredModelName(offered.key)] = {
            id: offered.id.trim(),
            behavior: behaviorForChoice(offered),
            ...(pricing ? { pricing } : {}),
        };
    }
    return { version: 1, models, routes };
}

/**
 * A price as a request carries it, before {@link selectionProblem} has looked
 * at it: any field may be missing, and all of them missing means no price.
 */
export interface PricingDraft {
    input?: number | null;
    output?: number | null;
    cachedInput?: number | null;
}

type ChoiceDraft = Omit<WorkspaceModelChoice, "pricing"> & { pricing?: PricingDraft | null };

/** An offered model as Settings sends it: a new one has no key yet. */
export type OfferedDraft = ChoiceDraft & { key?: string; label: string };

/** A selection as Settings sends it. A saved selection is one too. */
export type SelectionDraft = { default: ChoiceDraft } & Partial<
    Record<Exclude<(typeof WORKSPACE_MODEL_ROUTES)[number], "default">, ChoiceDraft>
> & { offered?: OfferedDraft[] };

const given = (value: number | null | undefined): value is number =>
    value !== null && value !== undefined;

/** No price at all: every field left empty. */
function isEmptyPrice(pricing: PricingDraft | null | undefined): boolean {
    return (
        !pricing || (!given(pricing.input) && !given(pricing.output) && !given(pricing.cachedInput))
    );
}

/** The price, when both sides are given and every given field is in bounds. */
function usablePrice(pricing: PricingDraft | null | undefined): ChatModelPricing | null {
    if (!pricing || !given(pricing.input) || !given(pricing.output)) return null;
    const price: ChatModelPricing = {
        input: pricing.input,
        output: pricing.output,
        ...(given(pricing.cachedInput) ? { cachedInput: pricing.cachedInput } : {}),
    };
    return Object.values(price).every(isPlausiblePrice) ? price : null;
}

/** What is wrong with one model's price, in words an admin can act on, or null. */
function pricingProblem(id: string, pricing: PricingDraft | null | undefined): string | null {
    if (isEmptyPrice(pricing) || usablePrice(pricing)) return null;
    if (!given(pricing?.input) || !given(pricing?.output)) {
        return `Give "${id}" both an input and an output price, or leave both empty.`;
    }
    return `Prices for "${id}" have to be between 0 and ${MAX_PRICE_TEXT} US dollars per 1M tokens.`;
}

/**
 * Check a selection before it is saved, so a bad one is refused in Settings
 * rather than discovered by the next person who asks a question. Returns the
 * first problem in words an admin can act on, or null.
 */
export function selectionProblem(selection: SelectionDraft): string | null {
    for (const route of WORKSPACE_MODEL_ROUTES) {
        const choice = selection[route];
        if (!choice) continue;
        if (!isPlausibleModelId(choice.id.trim())) {
            return `"${choice.id}" doesn't look like a model id. Copy it exactly as your provider lists it.`;
        }
        const problem = pricingProblem(choice.id.trim(), choice.pricing);
        if (problem) return problem;
    }
    const offeredProblem = offeredListProblem(selection.offered ?? []);
    if (offeredProblem) return offeredProblem;
    if (selection.vision && !selection.vision.vision) {
        return "The model for images has to be one that reads images.";
    }
    if (selection.reasoning && !selection.reasoning.reasoning) {
        return "The model for reasoning has to be one that reasons.";
    }
    return null;
}

/**
 * What is wrong with the models offered in Ask, or null. Names are what
 * people choose by, so two the same would be two buttons nobody can tell
 * apart; keys are how saved drafts find a model again.
 */
export function offeredListProblem(offered: readonly OfferedDraft[]): string | null {
    if (offered.length > MAX_OFFERED_MODELS) {
        return `Offer at most ${MAX_OFFERED_MODELS} models in Ask.`;
    }
    const labels = new Set<string>();
    const keys = new Set<string>();
    for (const model of offered) {
        const id = model.id.trim();
        if (!isPlausibleModelId(id)) {
            return `"${model.id}" doesn't look like a model id. Copy it exactly as your provider lists it.`;
        }
        const label = model.label.trim();
        if (!label) return `Give "${id}" a name people will see.`;
        if (label.length > MAX_OFFERED_LABEL_CHARS) {
            return `Keep the name for "${id}" to ${MAX_OFFERED_LABEL_CHARS} characters.`;
        }
        const folded = label.toLocaleLowerCase("en-US");
        if (labels.has(folded)) return `Two models are called "${label}". Give each its own name.`;
        labels.add(folded);
        if (model.key !== undefined) {
            if (!isModelKey(model.key) || keys.has(model.key)) {
                return "That isn't a valid model setup.";
            }
            keys.add(model.key);
        }
        const problem = pricingProblem(id, model.pricing);
        if (problem) return problem;
    }
    return null;
}

/** A fresh key for a newly offered model: eight hex characters, not taken. */
export function newOfferedModelKey(taken: ReadonlySet<string>): string {
    for (;;) {
        const key = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
        if (!taken.has(key)) return key;
    }
}

/**
 * The offered list as it is stored: trimmed, a price left empty removed, and
 * every new model given a key. `newKey` is a seam for tests.
 */
export function settledOffered(
    drafts: readonly OfferedDraft[],
    newKey: (taken: ReadonlySet<string>) => string = newOfferedModelKey
): WorkspaceOfferedModel[] {
    const taken = new Set(drafts.flatMap(draft => (draft.key ? [draft.key] : [])));
    return drafts.map(({ pricing, key, label, ...choice }) => {
        const assigned = key ?? newKey(taken);
        taken.add(assigned);
        const price = usablePrice(pricing);
        return {
            ...choice,
            id: choice.id.trim(),
            key: assigned,
            label: label.trim(),
            ...(price ? { pricing: price } : {}),
        };
    });
}

/**
 * The selection as it is stored: a price whose fields were all left empty is
 * no price. The save route checks with {@link selectionProblem} first, so
 * nothing else is dropped there; a connection test prices nothing and skips
 * that check, so a price it couldn't use is left off rather than refused.
 */
export function settledSelection(draft: SelectionDraft): WorkspaceModelSelection {
    const settle = ({ pricing, ...choice }: ChoiceDraft): WorkspaceModelChoice => {
        const price = usablePrice(pricing);
        return price ? { ...choice, pricing: price } : choice;
    };
    const selection: WorkspaceModelSelection = { default: settle(draft.default) };
    for (const route of WORKSPACE_MODEL_ROUTES) {
        const choice = draft[route];
        if (route !== "default" && choice) selection[route] = settle(choice);
    }
    if (draft.offered?.length) selection.offered = settledOffered(draft.offered);
    return selection;
}

export interface WorkspaceEndpointInput {
    baseUrl: string;
    apiKey?: string | null;
    selection: WorkspaceModelSelection;
}

/**
 * Build the chat configuration a workspace's work resolves against. Throws
 * {@link ChatConfigurationError} when the selection cannot serve the routes it
 * claims to.
 */
export function buildWorkspaceChatModelsConfig(input: WorkspaceEndpointInput): ChatModelsConfig {
    const problem = selectionProblem(input.selection);
    if (problem) throw new ChatConfigurationError(problem);
    return buildChatModelsConfig({
        file: workspaceModelsFile(input.selection),
        endpoint: {
            baseUrl: input.baseUrl,
            ...(input.apiKey ? { apiKey: input.apiKey } : {}),
            owner: "workspace",
            // The same identity rule the deployment's own endpoint carries:
            // whichever model answers, it introduces itself as the assistant.
            systemInstructions: ASSISTANT_IDENTITY_RULE,
        },
        sourceLabel: "Your workspace's model settings",
    });
}

/**
 * The configuration a turn runs on when someone picked an offered model in
 * Ask: the picked model answers on the main route (and on the image route
 * when it reads images), while the fast route — the quick background helpers
 * a turn calls — stays on the workspace's own fast model, or its main one.
 * Null when the configuration offers no model by that key.
 */
export function configWithOfferedModel(
    config: ChatModelsConfig,
    key: string
): ChatModelsConfig | null {
    const name = offeredModelName(key);
    const definition = config.models.get(name);
    if (!definition) return null;
    const readsImages = definition.behavior.input.includes("image");
    return {
        ...config,
        routes: {
            ...config.routes,
            default: name,
            fast: config.routes.fast ?? config.routes.default,
            ...(readsImages ? { vision: name } : {}),
        },
    };
}
