import type { WorkspaceSource } from "./types";

/**
 * The one place that knows a source's id prefix decides which API it lives
 * behind. Documents are `d<id>` rows in the document table; mindmaps are
 * `m<id>` rows in their own table with their own routes. Everything above this
 * — the rail, the viewer, the context menu — works on `WorkspaceSource` and
 * calls these, so a new kind of source is a new branch here and nowhere else.
 */

export type SourceKind = "document" | "mindmap" | "local";

export function sourceKind(source: Pick<WorkspaceSource, "id" | "type">): SourceKind {
    if (source.id.startsWith("m") && source.type === "mindmap") return "mindmap";
    if (source.id.startsWith("d")) return "document";
    return "local";
}

export function isMindmapSource(source: Pick<WorkspaceSource, "id" | "type">): boolean {
    return sourceKind(source) === "mindmap";
}

/** True when the source has a row on the server that can be renamed, moved or deleted. */
export function isPersistedSource(source: WorkspaceSource): boolean {
    switch (sourceKind(source)) {
        case "mindmap":
            return typeof source.mindmapId === "number" && source.mindmapId > 0;
        case "document":
            return typeof source.documentId === "number" && source.documentId > 0;
        default:
            return false;
    }
}

async function readError(res: Response, fallback: string): Promise<Error> {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    return new Error(body.message ?? body.error ?? fallback);
}

export async function renameSource(source: WorkspaceSource, title: string): Promise<void> {
    const kind = sourceKind(source);
    if (kind === "mindmap") {
        const res = await fetch(`/api/mindmaps/${source.mindmapId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title }),
        });
        if (!res.ok) throw await readError(res, "Failed to rename mindmap");
        return;
    }
    if (kind === "document") {
        const res = await fetch(`/api/documents/${source.documentId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title }),
        });
        if (!res.ok) throw await readError(res, "Failed to rename document");
        return;
    }
    throw new Error("This source is still being added");
}

export async function moveSource(source: WorkspaceSource, folder: string): Promise<void> {
    const kind = sourceKind(source);
    if (kind === "mindmap") {
        const res = await fetch(`/api/mindmaps/${source.mindmapId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folder }),
        });
        if (!res.ok) throw await readError(res, "Failed to move mindmap");
        return;
    }
    if (kind === "document") {
        const res = await fetch(`/api/documents/${source.documentId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ category: folder }),
        });
        if (!res.ok) throw await readError(res, "Failed to move document");
        return;
    }
    throw new Error("This source is still being added");
}

export interface DeleteOutcome {
    /** A soft delete the server can undo; `restore` puts it back. */
    restore?: () => Promise<void>;
}

/**
 * Delete a source. Documents are removed outright — that is what their API
 * does. Mindmaps are soft-deleted, so the outcome carries a `restore` the
 * caller can offer as an Undo.
 */
export async function deleteSource(source: WorkspaceSource): Promise<DeleteOutcome> {
    const kind = sourceKind(source);
    if (kind === "mindmap") {
        const id = source.mindmapId;
        const res = await fetch(`/api/mindmaps/${id}`, { method: "DELETE" });
        if (!res.ok) throw await readError(res, "Failed to delete mindmap");
        return {
            restore: async () => {
                const undo = await fetch(`/api/mindmaps/${id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ restore: true }),
                });
                if (!undo.ok) throw await readError(undo, "Failed to restore mindmap");
            },
        };
    }
    if (kind === "document") {
        const res = await fetch("/api/deleteDocument", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ docId: String(source.documentId) }),
        });
        if (!res.ok) throw await readError(res, "Failed to delete document");
        return {};
    }
    throw new Error("This source is still being added");
}
