/**
 * The Models & usage tab's screens and their paths, and who may open each.
 * Plain data, so deep links are pinned by tests rather than by whoever last
 * clicked through the tab.
 *
 *   /overview          the workspace: who is active, what it asked, what AI it used (analytics)
 *   /people            everyone, ranked — Cursor's leaderboard (analytics)
 *   /people/<id>       one person's numbers (analytics)
 *   /activity          AI use by day, person, feature and route (analytics)
 *   /documents         which documents get opened, and by how many people (analytics)
 *   /you               your own numbers beside the workspace median (everyone)
 *   /models            what Ask's model menu offers; managed by `models.manage`,
 *                      read-only for everyone else (everyone)
 *   /keys              the workspace's own API key or OpenRouter account — the
 *                      `byok` settings section (`models.manage`)
 *   /spending          balance, burn, the ledger, pricing and per-person limits (analytics)
 *
 * "analytics" is `analytics.view`. Ids are workspace member ids — the same
 * ones the Team tab's `/people/<id>` uses. Someone without `analytics.view`
 * has You and Models (and API keys, should their role manage the models),
 * and lands on You from any other path. `/keys` without `models.manage`
 * lands on Models for someone who may see the workspace's numbers, on You
 * for anyone else.
 */

export const USAGE_ROOTS = [
    "overview",
    "people",
    "activity",
    "documents",
    "you",
    "models",
    "keys",
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
    | { kind: "models" }
    | { kind: "keys" }
    | { kind: "spending" }
    | { kind: "not-found" };

const withFocus = (path: string, focus?: string | null) =>
    focus ? `${path}?focus=${encodeURIComponent(focus)}` : path;

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
    models: () => "/models",
    keys: (focus?: string | null) => withFocus("/keys", focus),
    spending: (focus?: string | null) => withFocus("/spending", focus),
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
    if (root === "models") return { kind: "models" };
    if (root === "keys") return { kind: "keys" };
    if (root === "spending") return { kind: "spending" };
    return { kind: "not-found" };
}

/** Screens only someone with `analytics.view` may open. */
export function isTeamScreen(screen: UsageScreen): boolean {
    switch (screen.kind) {
        case "you":
        case "models":
        case "keys":
        case "not-found":
            return false;
        default:
            return true;
    }
}

/** What the person's role lets them open in the tab. */
export interface UsageAccess {
    /** `analytics.view`: the workspace's numbers and its spending. */
    team: boolean;
    /** `models.manage`: the API keys, and changing what Models offers. */
    manageModels: boolean;
}

/**
 * Where someone who may not open `screen` is sent instead, or null when they
 * may open it (a path that names no screen included, for someone with the
 * workspace's numbers: they are told it doesn't exist).
 */
export function usageRedirectFor(screen: UsageScreen, access: UsageAccess): string | null {
    if (screen.kind === "keys" && !access.manageModels) {
        return access.team ? usagePaths.models() : USAGE_SELF_HOME;
    }
    if (access.team) return null;
    return isTeamScreen(screen) || screen.kind === "not-found" ? USAGE_SELF_HOME : null;
}
