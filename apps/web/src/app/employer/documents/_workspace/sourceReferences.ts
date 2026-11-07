import type { WorkspaceSource } from "./types";

/** Published document references resolve to their canonical workspace source. */
export function resolveSourceReference(
    sources: WorkspaceSource[],
    id: string
): WorkspaceSource | undefined {
    const source = sources.find(item => item.id === id);
    if (source || !/^d[1-9]\d*$/.test(id)) return source;
    const documentId = Number(id.slice(1));
    return sources.find(item => item.documentId === documentId);
}
