/**
 * Which Templated Drafts screen an app-relative path shows.
 *
 * Templated Drafts is a tab of the workspace, and its screens are paths
 * inside that tab ("/documents/12"), walked by the frame's rail, Back and
 * Forward. This is the switch that used to be `currentView` state in
 * DocumentGenerator. Plain data and no React, so it is tested on its own and
 * the tab, the rail and any link agree on what each path means.
 *
 * - "/"                 New document: the template library.
 * - "/documents"        My documents: every draft.
 * - "/documents/<id>"   One draft open in its editor, a record under My documents.
 * - "/assistant"        The assistant that recommends and pre-fills a template.
 */

/** First path segments that are Templated Drafts screens. "/" (New document) is always the tool's own. */
export const DRAFTS_ROOTS = ["documents", "assistant"] as const;

export type DraftsScreen =
    | { screen: "new" }
    | { screen: "documents" }
    | { screen: "document"; id: string }
    | { screen: "assistant" }
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
 * query and no trailing slash ("" is accepted as New document too). Anything
 * this does not know is "not-found", never New document, so a bad link says
 * so instead of quietly landing somewhere else. Whether a document id exists
 * is the screen's question, not the path's.
 */
export function draftsScreenFor(path: string): DraftsScreen {
    const [head, id, ...rest] = path.split("/").filter(Boolean);
    if (head === undefined) return { screen: "new" };
    switch (head) {
        case "documents":
            if (id === undefined) return { screen: "documents" };
            return rest.length === 0
                ? { screen: "document", id: decodeSegment(id) }
                : { screen: "not-found" };
        case "assistant":
            return id === undefined ? { screen: "assistant" } : { screen: "not-found" };
        default:
            return { screen: "not-found" };
    }
}

/** The path of one draft's editor. */
export function draftsDocumentPath(id: string): string {
    return `/documents/${encodeURIComponent(id)}`;
}
