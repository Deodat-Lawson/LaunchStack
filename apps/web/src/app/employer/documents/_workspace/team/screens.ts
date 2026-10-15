/**
 * The Team tab's screens and their paths. Plain data, so deep links are
 * pinned by tests rather than by whoever last clicked through the tab.
 *
 *   /people          everyone in the workspace (the tab's home)
 *   /people/<id>     one person: what you share with each other, their activity
 *   /groups          the workspace's groups
 *   /groups/<id>     one group: who is in it, managed by its creator
 *   /activity        who added, shared, moved, renamed or deleted what
 *
 * Ids are workspace member ids and group ids — the same ones Settings ›
 * People & access uses.
 */

export const TEAM_ROOTS = ["people", "groups", "activity"] as const;
export const TEAM_HOME = "/people";

export type TeamScreen =
    | { kind: "people" }
    | { kind: "person"; id: number }
    | { kind: "groups" }
    | { kind: "group"; id: number }
    | { kind: "activity" }
    | { kind: "not-found" };

export const teamPaths = {
    people: () => "/people",
    person: (id: number) => `/people/${id}`,
    groups: () => "/groups",
    group: (id: number) => `/groups/${id}`,
    activity: () => "/activity",
};

function idOf(segment: string | undefined): number | null {
    return segment && /^\d+$/.test(segment) ? Number(segment) : null;
}

export function teamScreenFor(path: string): TeamScreen {
    const parts = path.split("/").filter(Boolean);
    const [root, rest, extra] = parts;
    if (extra !== undefined) return { kind: "not-found" };
    if (root === undefined || root === "people") {
        if (rest === undefined) return { kind: "people" };
        const id = idOf(rest);
        return id === null ? { kind: "not-found" } : { kind: "person", id };
    }
    if (root === "groups") {
        if (rest === undefined) return { kind: "groups" };
        const id = idOf(rest);
        return id === null ? { kind: "not-found" } : { kind: "group", id };
    }
    if (root === "activity" && rest === undefined) return { kind: "activity" };
    return { kind: "not-found" };
}
