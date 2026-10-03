/**
 * Which Proposals screen an app-relative path shows.
 *
 * Proposals is a tab of the workspace, not a route tree: its location is a
 * path inside the tab ("/write/12"), and this is the switch that used to be
 * the folders under `app/employer/tools/proposals/`. Plain data and no React,
 * so it is tested on its own and the harness, the tab and the redirect pages
 * agree on what each path means.
 */

/** First path segments that are Proposals screens. "/" (Home) is always the tool's own. */
export const PROPOSALS_ROOTS = ["write", "funders", "profile", "library"] as const;

export type ProposalsScreen =
    | { screen: "home" }
    | { screen: "applications" }
    | { screen: "application"; id: string }
    | { screen: "funders" }
    | { screen: "profile" }
    | { screen: "library" }
    | { screen: "not-found" };

function decodeSegment(segment: string): string {
    try {
        return decodeURIComponent(segment);
    } catch {
        // A stray "%" in a hand-typed link: the raw segment is the best guess.
        return segment;
    }
}

/**
 * `path` is what `useToolPathname()` returns: it starts with "/", has no
 * query and no trailing slash ("" is accepted as Home too). Anything this
 * does not know — an old or mistyped link — is "not-found", never Home, so a
 * bad link says so instead of quietly landing somewhere else.
 */
export function proposalsScreenFor(path: string): ProposalsScreen {
    const segments = path.split("/").filter(Boolean);
    const [head, id, ...rest] = segments;
    if (head === undefined) return { screen: "home" };
    switch (head) {
        case "write":
            if (id === undefined) return { screen: "applications" };
            return rest.length === 0
                ? { screen: "application", id: decodeSegment(id) }
                : { screen: "not-found" };
        case "funders":
        case "profile":
        case "library":
            return id === undefined ? { screen: head } : { screen: "not-found" };
        default:
            return { screen: "not-found" };
    }
}
