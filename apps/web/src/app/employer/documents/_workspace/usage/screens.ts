/**
 * The Usage tab's screens and their paths. Plain data, so deep links are
 * pinned by tests rather than by whoever last clicked through the tab.
 *
 *   /overview          the workspace: who is active, what it asked, what AI it used (admins)
 *   /people            everyone, ranked — Cursor's leaderboard (admins)
 *   /people/<id>       one person's numbers (admins)
 *   /activity          AI use by day, person, feature and route (admins)
 *   /documents         which documents get opened, and by how many people (admins)
 *   /you               your own numbers beside the workspace median (everyone)
 *   /spending          balance, burn, the ledger, pricing and per-person limits (admins)
 *
 * Ids are workspace member ids — the same ones the Team tab's `/people/<id>`
 * uses. Someone without `analytics.view` has one screen, `/you`, and lands
 * there from any path.
 */

export const USAGE_ROOTS = [
    "overview",
    "people",
    "activity",
    "documents",
    "you",
    "spending",
] as const;
export const USAGE_HOME = "/overview";
export const USAGE_SELF_HOME = "/you";

export type UsageScreen =
    | { kind: "overview" }
    | { kind: "people" }
    | { kind: "person"; id: number }
    | { kind: "activity" }
    | { kind: "documents" }
    | { kind: "you" }
    | { kind: "spending" }
    | { kind: "not-found" };

export const usagePaths = {
    overview: () => "/overview",
    people: () => "/people",
    person: (id: number) => `/people/${id}`,
    activity: (filters: { person?: number; feature?: string } = {}) => {
        const query = new URLSearchParams();
        if (filters.person !== undefined) query.set("person", String(filters.person));
        if (filters.feature) query.set("feature", filters.feature);
        const text = query.toString();
        return text ? `/activity?${text}` : "/activity";
    },
    documents: () => "/documents",
    you: () => "/you",
    spending: (focus?: string | null) =>
        focus ? `/spending?focus=${encodeURIComponent(focus)}` : "/spending",
};

function idOf(segment: string | undefined): number | null {
    return segment && /^\d+$/.test(segment) ? Number(segment) : null;
}

export function usageScreenFor(path: string): UsageScreen {
    const [root, rest, extra] = path.split("/").filter(Boolean);
    if (extra !== undefined) return { kind: "not-found" };
    if (root === undefined || root === "overview") {
        return rest === undefined ? { kind: "overview" } : { kind: "not-found" };
    }
    if (root === "people") {
        if (rest === undefined) return { kind: "people" };
        const id = idOf(rest);
        return id === null ? { kind: "not-found" } : { kind: "person", id };
    }
    if (rest !== undefined) return { kind: "not-found" };
    if (root === "activity") return { kind: "activity" };
    if (root === "documents") return { kind: "documents" };
    if (root === "you") return { kind: "you" };
    if (root === "spending") return { kind: "spending" };
    return { kind: "not-found" };
}

/** Screens only someone with `analytics.view` may open. */
export function isTeamScreen(screen: UsageScreen): boolean {
    return screen.kind !== "you" && screen.kind !== "not-found";
}
