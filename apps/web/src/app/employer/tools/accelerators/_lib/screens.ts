export const ACCELERATORS_ROOTS = ["programs", "tracker"] as const;

export function programPath(id: string): string {
    return `/programs/${encodeURIComponent(id)}`;
}

export type AcceleratorsScreen =
    | { kind: "programs" }
    | { kind: "program"; id: string }
    | { kind: "tracker" }
    | { kind: "not-found" };

export function acceleratorsScreenFor(path: string): AcceleratorsScreen {
    if (path === "/" || path === "/programs") return { kind: "programs" };
    if (path === "/tracker") return { kind: "tracker" };
    const match = /^\/programs\/([^/]+)$/.exec(path);
    if (!match) return { kind: "not-found" };
    try {
        const id = decodeURIComponent(match[1]!);
        return { kind: "program", id };
    } catch {
        return { kind: "not-found" };
    }
}
