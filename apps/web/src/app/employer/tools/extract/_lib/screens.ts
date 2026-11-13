import { parseToolHref } from "~/lib/tool-app/locations";

/**
 * Which Extract screen an app-relative href shows. Plain data, no React, so
 * the table — the list, the form with documents already chosen, one table —
 * is pinned by a unit test.
 *
 * The list lives at "/t" so its tab in the bar stays lit on a table
 * ("/t/12"); "/" lands there too.
 */
export type ExtractScreen =
    | { kind: "list" }
    /** `docs`: document ids another surface chose (`/new?docs=12,15,18`). */
    | { kind: "new"; docs: number[] }
    | { kind: "table"; id: number }
    | { kind: "not-found" };

/** First path segments that are Extract screens; the tab's `roots`. */
export const EXTRACT_ROOTS = ["t", "new"] as const;

/** Where "/" lands. */
export const EXTRACT_HOME = "/t";

export const tablePath = (id: number) => `/t/${id}`;

/**
 * Document ids out of a `docs` query: "12,15,18". A workspace source id
 * ("d12") counts as its number, so the Knowledge tab can pass its selection
 * as it has it; anything else (a mindmap "m3", a note) is left out. Order
 * kept, repeats dropped.
 */
export function parseDocIds(raw: string | null | undefined): number[] {
    if (!raw) return [];
    const ids: number[] = [];
    for (const part of raw.split(",")) {
        const match = /^d?(\d+)$/.exec(part.trim());
        if (!match) continue;
        const id = Number(match[1]);
        if (Number.isSafeInteger(id) && id > 0 && !ids.includes(id)) ids.push(id);
    }
    return ids;
}

/** The form, with these documents already chosen. */
export function newPath(docIds: readonly number[] = []): string {
    return docIds.length > 0 ? `/new?docs=${docIds.join(",")}` : "/new";
}

export function extractScreenFor(href: string): ExtractScreen {
    const { path, search } = parseToolHref(href);
    if (path === "/" || path === "/t") return { kind: "list" };
    if (path === "/new") {
        return { kind: "new", docs: parseDocIds(new URLSearchParams(search).get("docs")) };
    }
    const match = /^\/t\/(\d+)$/.exec(path);
    if (match) return { kind: "table", id: Number(match[1]) };
    return { kind: "not-found" };
}
