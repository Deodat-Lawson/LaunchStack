/**
 * What someone can pick in Ask's model menu, as one value.
 *
 * - `default` and `fast` are the two tiers every workspace has (Standard and
 *   Fast on screen). Which model serves them is the operator's or the
 *   workspace admin's choice, and the deployment's is never named.
 * - `model:<key>` is one of the models a workspace admin offers in Models &
 *   usage › Models, under the name the admin gave it. `<key>` is a short
 *   handle the server assigned when it was first saved: it survives a rename
 *   and never carries the provider's model id.
 *
 * A pick travels as a route plus, for an offered model, its key
 * (`{ modelRoute: "default", modelKey }`); compare mode lists picks.
 *
 * Client-safe and dependency-free: the composer, the saved-turn schemas and
 * the query route share it.
 */

/** The tiers the picker offers. `reasoning` and `vision` are chosen by the server. */
export const PICKER_ROUTES = ["default", "fast"] as const;
export type PickerRoute = (typeof PICKER_ROUTES)[number];

/** A model a workspace offers, by its key. */
export type OfferedModelPick = `model:${string}`;
export type ModelPick = PickerRoute | OfferedModelPick;

/** Keys the server assigns: lower-case letters, digits and dashes, 1–40 characters. */
export const MODEL_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** A `model:<key>` pick, whole. */
export const OFFERED_MODEL_PICK_PATTERN = /^model:[a-z0-9][a-z0-9-]{0,39}$/;

/** At most this many models offered in Ask, beside Standard and Fast. */
export const MAX_OFFERED_MODELS = 20;

/** The longest name an admin may give an offered model. */
export const MAX_OFFERED_LABEL_CHARS = 60;

const PREFIX = "model:";

export function isModelKey(value: unknown): value is string {
    return typeof value === "string" && MODEL_KEY_PATTERN.test(value);
}

export function isPickerRoute(value: unknown): value is PickerRoute {
    return value === "default" || value === "fast";
}

export function isModelPick(value: unknown): value is ModelPick {
    return isPickerRoute(value) || isOfferedModelPick(value);
}

export function isOfferedModelPick(value: unknown): value is OfferedModelPick {
    return typeof value === "string" && OFFERED_MODEL_PICK_PATTERN.test(value);
}

export function pickOfModel(key: string): OfferedModelPick {
    return `${PREFIX}${key}`;
}

/** The offered model a pick names, or undefined for a tier. */
export function modelKeyOfPick(pick: ModelPick): string | undefined {
    return pick.startsWith(PREFIX) ? pick.slice(PREFIX.length) : undefined;
}

/** The route a pick runs on: an offered model answers on the main route. */
export function routeOfPick(pick: ModelPick): PickerRoute {
    return isPickerRoute(pick) ? pick : "default";
}

/** What a request carries for a pick. */
export function requestOfPick(pick: ModelPick): { modelRoute: PickerRoute; modelKey?: string } {
    const modelKey = modelKeyOfPick(pick);
    return modelKey ? { modelRoute: "default", modelKey } : { modelRoute: routeOfPick(pick) };
}

/** The pick a request (or a saved draft) stands for. Anything unreadable is Standard. */
export function pickOfRequest(input: { modelRoute?: unknown; modelKey?: unknown }): ModelPick {
    if (isModelKey(input.modelKey)) return pickOfModel(input.modelKey);
    return isPickerRoute(input.modelRoute) ? input.modelRoute : "default";
}
