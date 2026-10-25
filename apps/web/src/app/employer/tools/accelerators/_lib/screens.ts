export const ACCELERATORS_ROOTS = ["programs", "applications"] as const;

export function programPath(id: string): string {
    return `/programs/${encodeURIComponent(id)}`;
}

export function applicationPath(id: string): string {
    return `/applications/${encodeURIComponent(id)}`;
}

export type AcceleratorsScreen =
    | { kind: "programs" }
    | { kind: "program"; id: string }
    | { kind: "application"; id: string }
    | { kind: "not-found" };

export function acceleratorsScreenFor(path: string): AcceleratorsScreen {
    if (path === "/" || path === "/programs") return { kind: "programs" };
    const match = /^\/(programs|applications)\/([^/]+)$/.exec(path);
    if (!match) return { kind: "not-found" };
    try {
        const id = decodeURIComponent(match[2]!);
        return { kind: match[1] === "programs" ? "program" : "application", id };
    } catch {
        return { kind: "not-found" };
    }
}
