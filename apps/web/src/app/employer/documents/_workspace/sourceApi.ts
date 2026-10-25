import type { useTranslations } from "next-intl";

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

/** What failed, when the server gave no words of its own: a key in `sources.sourceApi`. */
export type SourceApiFailure =
    | "renameMindmap"
    | "renameDocument"
    | "moveMindmap"
    | "moveDocument"
    | "deleteMindmap"
    | "restoreMindmap"
    | "deleteDocument"
    | "stillAdding"
    | "nothingToRetry"
    | "retry";

/** English for each failure — the error's `message`, for callers that show it as is. */
const FAILURE_TEXT: Record<SourceApiFailure, string> = {
    renameMindmap: "Failed to rename mindmap",
    renameDocument: "Failed to rename document",
    moveMindmap: "Failed to move mindmap",
    moveDocument: "Failed to move document",
    deleteMindmap: "Failed to delete mindmap",
    restoreMindmap: "Failed to restore mindmap",
    deleteDocument: "Failed to delete document",
    stillAdding: "This source is still being added",
    nothingToRetry: "This source has nothing to retry",
    retry: "Couldn't retry processing",
};

/**
 * A failed source call. `message` is the server's words when it sent some,
 * else English; `sourceApiErrorMessage` says it in the reader's language.
 */
export class SourceApiError extends Error {
    constructor(
        readonly failure: SourceApiFailure,
        /** The server's own message, shown as is. */
        readonly serverMessage: string | null = null
    ) {
        super(serverMessage ?? FAILURE_TEXT[failure]);
        this.name = "SourceApiError";
    }
}

/** `useTranslations("sources.sourceApi")`. */
export type SourceApiTranslator = ReturnType<typeof useTranslations<"sources.sourceApi">>;

/**
 * What to show for an error from this module: the server's words, or what
 * failed in the reader's language; `otherwise` for anything else thrown.
 */
export function sourceApiErrorMessage(
    error: unknown,
    t: SourceApiTranslator,
    otherwise: string
): string {
    if (error instanceof SourceApiError) return error.serverMessage ?? t(error.failure);
    return error instanceof Error ? error.message : otherwise;
}

async function readError(res: Response, failure: SourceApiFailure): Promise<Error> {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    return new SourceApiError(failure, body.message ?? body.error ?? null);
}

export async function renameSource(source: WorkspaceSource, title: string): Promise<void> {
    const kind = sourceKind(source);
    if (kind === "mindmap") {
        const res = await fetch(`/api/mindmaps/${source.mindmapId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title }),
        });
        if (!res.ok) throw await readError(res, "renameMindmap");
        return;
    }
    if (kind === "document") {
        const res = await fetch(`/api/documents/${source.documentId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title }),
        });
        if (!res.ok) throw await readError(res, "renameDocument");
        return;
    }
    throw new SourceApiError("stillAdding");
}

/** What a move did to a file's own audience (ADR-014's Drive rule), when the server says. */
export type MoveAccessOutcome = "inherits_folder" | "made_private" | "unchanged";

export interface MoveOutcome {
    /**
     * `inherits_folder` — now visible to whoever can open the new folder;
     * `made_private` — filed loose, so only you; `unchanged` — it keeps its
     * own audience. A mindmap draft has none of its own, so it reports only
     * the first two.
     */
    access?: MoveAccessOutcome;
}

export async function moveSource(source: WorkspaceSource, folder: string): Promise<MoveOutcome> {
    const kind = sourceKind(source);
    if (kind === "mindmap") {
        const res = await fetch(`/api/mindmaps/${source.mindmapId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folder }),
        });
        if (!res.ok) throw await readError(res, "moveMindmap");
        const body = (await res.json().catch(() => ({}))) as {
            move?: { access?: MoveAccessOutcome };
        };
        return { access: body.move?.access };
    }
    if (kind === "document") {
        const res = await fetch(`/api/documents/${source.documentId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ category: folder }),
        });
        if (!res.ok) throw await readError(res, "moveDocument");
        const body = (await res.json().catch(() => ({}))) as {
            move?: { access?: MoveAccessOutcome };
        };
        return { access: body.move?.access };
    }
    throw new SourceApiError("stillAdding");
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
        if (!res.ok) throw await readError(res, "deleteMindmap");
        return {
            restore: async () => {
                const undo = await fetch(`/api/mindmaps/${id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ restore: true }),
                });
                if (!undo.ok) throw await readError(undo, "restoreMindmap");
            },
        };
    }
    if (kind === "document") {
        const res = await fetch("/api/deleteDocument", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ docId: String(source.documentId) }),
        });
        if (!res.ok) throw await readError(res, "deleteDocument");
        return {};
    }
    throw new SourceApiError("stillAdding");
}

/**
 * Run a failed source's processing again. Only document rows process; a
 * mindmap retries through the document it published.
 */
export async function retrySourceProcessing(source: WorkspaceSource): Promise<void> {
    if (typeof source.documentId !== "number" || source.documentId <= 0) {
        throw new SourceApiError("nothingToRetry");
    }
    const res = await fetch(`/api/documents/${source.documentId}/retry`, { method: "POST" });
    if (!res.ok) throw await readError(res, "retry");
}
