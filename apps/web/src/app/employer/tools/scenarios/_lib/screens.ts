import { parseToolHref } from "~/lib/tool-app/locations";

/**
 * Which Scenarios screen an app-relative href shows. Plain data, no React, so
 * the table — the list, the form, a run and its sub-tab, a post jumped to — is
 * pinned by a unit test.
 *
 * The list lives at "/runs" so its tab in the bar stays lit on a run
 * ("/runs/12"); "/" lands there too.
 */
export type RunTab = "report" | "feed" | "people" | "ask" | "sources";

export const RUN_TABS: readonly RunTab[] = ["report", "feed", "people", "ask", "sources"];

export type ScenariosScreen =
    | { kind: "list" }
    | { kind: "new" }
    | {
          kind: "run";
          id: number;
          /** null: the screen picks (Report). */
          tab: RunTab | null;
          /** A post to scroll to and highlight in the Feed. */
          post: string | null;
          /** A source row to highlight in Sources ("E3"). */
          source: string | null;
          /** A person whose sheet is open. */
          person: string | null;
      }
    | { kind: "not-found" };

/** First path segments that are Scenarios screens; the tab's `roots`. */
export const SCENARIOS_ROOTS = ["runs", "new"] as const;

/** Where "/" lands. */
export const SCENARIOS_HOME = "/runs";

export function runPath(id: number, query: Record<string, string | null | undefined> = {}) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value) search.set(key, value);
    const qs = search.toString();
    return `/runs/${id}${qs ? `?${qs}` : ""}`;
}

/** "" means not set. */
const nonEmpty = (value: string | null): string | null => (value === "" ? null : value);

export function scenariosScreenFor(href: string): ScenariosScreen {
    const { path, search } = parseToolHref(href);
    if (path === "/" || path === "/runs") return { kind: "list" };
    if (path === "/new") return { kind: "new" };
    const match = /^\/runs\/(\d+)$/.exec(path);
    if (match) {
        const params = new URLSearchParams(search);
        const tab = params.get("tab");
        return {
            kind: "run",
            id: Number(match[1]),
            tab: RUN_TABS.includes(tab as RunTab) ? (tab as RunTab) : null,
            post: nonEmpty(params.get("post")),
            source: nonEmpty(params.get("source")),
            person: nonEmpty(params.get("person")),
        };
    }
    return { kind: "not-found" };
}
