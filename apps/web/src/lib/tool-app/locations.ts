/**
 * Where a Studio tool can be pointed at, as plain data the server and the
 * client agree on.
 *
 * Every tool is a tab of the workspace (`/employer/documents`). A tool with
 * screens of its own — Growth, Proposals, Vantage — keeps its location inside
 * the tab as an app-relative path ("/prospects/companies/12"). This module
 * turns that into a link a person can share, and turns the links that existed
 * before tools were tabs (`/employer/tools/growth/prospects/…`) back into a
 * tool and a location, so no bookmark, history row or server-built href ever
 * leaves the workspace.
 *
 * No React here: route handlers' redirect pages import it too.
 */

/** The page every tool tab lives on. */
export const WORKSPACE_PATH = "/employer/documents";

/** A tool's location inside its tab. `path` always starts with "/". */
export interface ToolLocation {
    path: string;
    /** "" or a query string starting with "?". */
    search: string;
}

export interface ToolTarget {
    toolId: string;
    /** App-relative, e.g. "/prospects/companies?view=new". */
    at: string;
}

/** Splits an app-relative href into its path and query, normalising the path. */
export function parseToolHref(href: string): ToolLocation {
    const hashless = href.split("#")[0] ?? "";
    const q = hashless.indexOf("?");
    const rawPath = q === -1 ? hashless : hashless.slice(0, q);
    const query = q === -1 ? "" : hashless.slice(q + 1);
    return { path: normalizeToolPath(rawPath), search: query ? `?${query}` : "" };
}

export function formatToolHref(location: ToolLocation): string {
    return `${location.path}${location.search}`;
}

/** "" and "/" are the tool's home; trailing slashes are dropped. */
export function normalizeToolPath(path: string): string {
    if (!path || path === "/") return "/";
    const withSlash = path.startsWith("/") ? path : `/${path}`;
    return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") || "/" : withSlash;
}

/** The link that opens `toolId`'s tab, at `at` when given. */
export function toolTabHref(toolId: string, at?: string): string {
    const params = new URLSearchParams({ feature: toolId });
    if (at && at !== "/") params.set("at", at);
    return `${WORKSPACE_PATH}?${params.toString()}`;
}

/**
 * Site paths that used to be a tool's own pages, longest prefix first. `at`
 * maps the rest of the path (with its leading slash, or "") to the location
 * inside the tab.
 */
const LEGACY_TOOL_ROUTES: readonly {
    prefix: string;
    toolId: string;
    at: (rest: string) => string;
}[] = [
    { prefix: "/employer/tools/growth", toolId: "growth", at: rest => rest || "/" },
    { prefix: "/employer/tools/prospects", toolId: "growth", at: rest => `/prospects${rest}` },
    {
        prefix: "/employer/tools/distribution",
        toolId: "growth",
        at: () => "/prospects",
    },
    {
        prefix: "/employer/tools/marketing-pipeline",
        toolId: "growth",
        at: () => "/brand/campaigns",
    },
    { prefix: "/employer/tools/proposals", toolId: "proposals", at: rest => rest || "/" },
    { prefix: "/employer/tools/vantage", toolId: "vantage", at: rest => rest || "/" },
];

/**
 * Feature ids that are now a place inside a tool: `?feature=brand` and the
 * palette's Brand row open Growth on Brand.
 */
export const TOOL_ALIASES: Readonly<Record<string, ToolTarget>> = {
    brand: { toolId: "growth", at: "/brand" },
    prospects: { toolId: "growth", at: "/prospects" },
    marketing: { toolId: "growth", at: "/brand/campaigns" },
    distribution: { toolId: "growth", at: "/prospects" },
};

/**
 * The tool and location a site href points at, or null when it is not a
 * tool's. Understands both shapes: the old `/employer/tools/<tool>/…` pages
 * and the workspace's own `?feature=<tool>&at=…` links.
 */
export function toolTargetFromHref(href: string): ToolTarget | null {
    let url: URL;
    try {
        url = new URL(href, "http://launchstack.local");
    } catch {
        return null;
    }
    const path = url.pathname.replace(/\/+$/, "");
    if (path === WORKSPACE_PATH) {
        const feature = url.searchParams.get("feature");
        if (!feature) return null;
        const alias = TOOL_ALIASES[feature];
        if (alias) return alias;
        const at = url.searchParams.get("at");
        return at ? { toolId: feature, at: formatToolHref(parseToolHref(at)) } : null;
    }
    for (const route of LEGACY_TOOL_ROUTES) {
        if (path === route.prefix || path.startsWith(`${route.prefix}/`)) {
            const rest = path.slice(route.prefix.length);
            const location = parseToolHref(route.at(rest));
            // The old page's query rides along: `?view=new`, `?week=…`.
            return {
                toolId: route.toolId,
                at: formatToolHref({ path: location.path, search: url.search || location.search }),
            };
        }
    }
    return null;
}

/**
 * Whether an app-relative href belongs to a tool whose top-level screens are
 * `roots`. "/" is always the tool's own; anything else must start with one
 * of its roots, so a site path like "/employer/settings" is never mistaken
 * for a screen. A query alone ("?view=new") stays on the current screen.
 */
export function isToolPath(href: string, roots: readonly string[]): boolean {
    // "" is a base path with nothing after it: the tool's home.
    if (href === "" || href.startsWith("?")) return true;
    if (!href.startsWith("/") || href.startsWith("//")) return false;
    const { path } = parseToolHref(href);
    if (path === "/") return true;
    const first = path.split("/")[1] ?? "";
    return roots.includes(first);
}
