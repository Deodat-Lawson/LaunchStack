/**
 * Which Rewrite screen an app-relative path shows.
 *
 * Rewrite is a tab of the workspace with a history of its own (see
 * `components/tool-app`). Its location is a path inside the tab, and this is
 * the switch from that path to a screen. Plain data and no React, so it is
 * tested on its own and the tab, its rail and its links agree on what each
 * path means.
 *
 * | Path             | Screen                                                  |
 * | ---------------- | ------------------------------------------------------- |
 * | `/`              | New rewrite: start the workflow, import, paste, blank   |
 * | `/rewrites`      | My rewrites: every saved rewrite, searchable            |
 * | `/rewrites/<id>` | One saved rewrite, open in the editor                   |
 * | `/rewrites/new`  | A rewrite not saved yet, open in the editor             |
 * | `/steps`         | The step-by-step workflow (input, options, review)      |
 */

/** First path segments that are Rewrite screens. "/" (New rewrite) is always the tool's own. */
export const REWRITE_ROOTS = ["rewrites", "steps"] as const;

export const NEW_REWRITE_PATH = "/";
export const MY_REWRITES_PATH = "/rewrites";
/**
 * The editor before its first save. Saved rewrites have numeric ids, so
 * "new" never names one; the first save replaces this entry with the
 * rewrite's own path.
 */
export const UNSAVED_REWRITE_PATH = "/rewrites/new";
export const WORKFLOW_PATH = "/steps";

/** The path of a saved rewrite in the editor. */
export function rewritePath(id: string): string {
    return `${MY_REWRITES_PATH}/${encodeURIComponent(id)}`;
}

export type RewriteScreen =
    | { screen: "new" }
    | { screen: "rewrites" }
    | { screen: "rewrite"; id: string }
    | { screen: "unsaved" }
    | { screen: "workflow" }
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
 * query and no trailing slash ("" is accepted as New rewrite too). Anything
 * this does not know is "not-found", never New rewrite, so a bad link says so
 * instead of quietly landing somewhere else. An id that names no rewrite is
 * still a "rewrite" screen; the tool says that rewrite is gone once the list
 * has loaded.
 */
export function rewriteScreenFor(path: string): RewriteScreen {
    const [head, id, ...rest] = path.split("/").filter(Boolean);
    if (head === undefined) return { screen: "new" };
    if (head === "steps")
        return id === undefined ? { screen: "workflow" } : { screen: "not-found" };
    if (head !== "rewrites") return { screen: "not-found" };
    if (id === undefined) return { screen: "rewrites" };
    if (rest.length > 0) return { screen: "not-found" };
    if (id === "new") return { screen: "unsaved" };
    return { screen: "rewrite", id: decodeSegment(id) };
}

/** Screens that show the editor: the tool keeps the editor mounted across the first save. */
export function isEditorScreen(
    screen: RewriteScreen
): screen is { screen: "rewrite"; id: string } | { screen: "unsaved" } {
    return screen.screen === "rewrite" || screen.screen === "unsaved";
}
