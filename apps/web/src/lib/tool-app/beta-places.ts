/**
 * Places inside a Studio app that are still being built while the app around
 * them is not. Growth is out of beta for its Prospects screens, but its Brand
 * screens ("/brand", "/brand/compose", …) are still beta: they are listed,
 * linked and shown only while the workspace's beta switch (`labs.betaApps`,
 * Workspace › Labs) is on, and Brand's APIs refuse otherwise
 * (`~/server/beta-apps`). A whole app still being built is marked `beta` in
 * the Studio registry instead.
 *
 * No React here, so the rule can be tested and read on its own.
 */

import { TOOL_ALIASES, parseToolHref, toolTargetFromHref, type ToolTarget } from "./locations";

/** App id → the app-relative path prefixes that are beta inside it. */
const BETA_PLACES: Readonly<Record<string, readonly string[]>> = {
    growth: ["/brand"],
};

/** Whether `at` (app-relative, inside `toolId`'s tab) is a place still being built. */
export function isBetaPlace(toolId: string, at: string | null | undefined): boolean {
    if (!at || !Object.prototype.hasOwnProperty.call(BETA_PLACES, toolId)) return false;
    const { path } = parseToolHref(at);
    return BETA_PLACES[toolId]!.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * The tool and place an id or a link opens, when it names a place: the ⌘K
 * row "brand", `?feature=marketing`, `?feature=growth&at=/brand/accounts`.
 */
export function toolPlaceFor(idOrHref: string): ToolTarget | null {
    if (Object.prototype.hasOwnProperty.call(TOOL_ALIASES, idOrHref)) {
        return TOOL_ALIASES[idOrHref]!;
    }
    return idOrHref.includes("?") || idOrHref.startsWith("/") ? toolTargetFromHref(idOrHref) : null;
}

/** Whether an id or a link opens a place still being built. */
export function opensBetaPlace(idOrHref: string): boolean {
    const place = toolPlaceFor(idOrHref);
    return place ? isBetaPlace(place.toolId, place.at) : false;
}
