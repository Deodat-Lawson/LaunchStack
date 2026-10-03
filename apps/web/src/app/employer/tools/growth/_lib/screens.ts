import { parseToolHref } from "~/lib/tool-app/locations";

/**
 * Which Growth screen a location inside the tab shows.
 *
 * Growth used to be a route tree (`/employer/tools/growth/brand/compose`,
 * one `page.tsx` per screen). It is a tab of the workspace now, so the
 * switch Next's router did lives here instead: a plain function over the
 * app-relative path, kept free of React so it can be tested on its own and
 * so the paths below stay the one list of what Growth can show.
 */

/** First path segments that are Growth's own screens. */
export const GROWTH_ROOTS = ["brand", "prospects"] as const;

/** Where "/" lands: Growth opens on Brand, Prospects is one click away in the bar. */
export const GROWTH_HOME = "/brand";

export type GrowthScreen =
    | { key: "brand-overview" }
    | { key: "brand-compose" }
    | { key: "brand-calendar" }
    | { key: "brand-campaigns" }
    | { key: "brand-accounts" }
    | { key: "prospects-home" }
    | { key: "prospects-companies" }
    | { key: "prospects-company"; id: string }
    | { key: "prospects-people" }
    | { key: "prospects-deals" }
    | { key: "prospects-runs" }
    | { key: "prospects-segment" }
    | { key: "prospects-sources" }
    | { key: "not-found" };

// Maps, not object literals: a path segment is user input, and
// "/brand/constructor" must not find something on Object.prototype.
const BRAND = new Map<string, GrowthScreen>([
    ["", { key: "brand-overview" }],
    ["compose", { key: "brand-compose" }],
    ["calendar", { key: "brand-calendar" }],
    ["campaigns", { key: "brand-campaigns" }],
    ["accounts", { key: "brand-accounts" }],
]);

const PROSPECTS = new Map<string, GrowthScreen>([
    ["", { key: "prospects-home" }],
    ["companies", { key: "prospects-companies" }],
    ["people", { key: "prospects-people" }],
    ["deals", { key: "prospects-deals" }],
    ["runs", { key: "prospects-runs" }],
    ["segment", { key: "prospects-segment" }],
    ["sources", { key: "prospects-sources" }],
]);

const NOT_FOUND: GrowthScreen = { key: "not-found" };

function decode(segment: string): string {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}

/**
 * The screen for an app-relative path ("/prospects/companies/42"). A query
 * or a trailing slash is ignored; "/" is Brand's overview, the same place
 * the tab's `home` sends it.
 */
export function growthScreenFor(path: string): GrowthScreen {
    const { path: normalized } = parseToolHref(path);
    if (normalized === "/") return BRAND.get("")!;
    const [area, screen = "", id, ...rest] = normalized.slice(1).split("/");
    if (rest.length > 0) return NOT_FOUND;
    if (area === "prospects" && screen === "companies" && id !== undefined) {
        return id ? { key: "prospects-company", id: decode(id) } : NOT_FOUND;
    }
    // Below here a third segment is always one too many.
    if (id !== undefined) return NOT_FOUND;
    if (area === "brand") return BRAND.get(screen) ?? NOT_FOUND;
    if (area === "prospects") return PROSPECTS.get(screen) ?? NOT_FOUND;
    return NOT_FOUND;
}
