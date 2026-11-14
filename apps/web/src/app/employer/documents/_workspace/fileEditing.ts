/**
 * Editing a file in LaunchStack: whether a source offers it, and the three
 * calls the editor makes. The server owns every conversion — the editor
 * always sends HTML (or plain text for a .txt) and the server writes
 * Markdown, Word, or the linked Google Doc from it — so nothing here knows a
 * file format.
 */
import { editableKindOf, type EditableDocumentLike, type EditableKind } from "~/lib/file-editing";
import { isMindmapSource } from "./sourceApi";
import { canChangeSource } from "./sourceContextMenu";
import type { WorkspaceSource } from "./types";

/**
 * Which files the editor takes is `editableKindOf` in `~/lib/file-editing`:
 * one rule shared with the route, so Edit never offers what it would refuse.
 */
export type EditableFileKind = EditableKind;

/**
 * Does the viewer offer Edit for this source? A saved document the caller
 * may change (ADR-014: a file shared to view is read-only), of a kind the
 * editor writes back. `doc` is the fetched row; until it arrives, no.
 */
export function canEditFileHere(
    source: WorkspaceSource,
    doc: EditableDocumentLike | null
): boolean {
    if (!doc || isMindmapSource(source)) return false;
    if (!(typeof source.documentId === "number" && source.documentId > 0)) return false;
    if (!canChangeSource(source)) return false;
    return editableKindOf(doc) !== null;
}

/** GET /api/documents/[id]/editable */
export interface EditableContent {
    documentId: number;
    title: string;
    kind: EditableFileKind;
    mode: "rich" | "plain";
    html: string;
    text: string;
    /** Opaque: sent back with the save, so a save over a newer copy is refused. */
    base: string;
    drive: { url: string | null; native: boolean } | null;
    /** What a save keeps and drops, in the reader's language; null when nothing. */
    notice: string | null;
}

/** PUT /api/documents/[id]/editable */
export interface SavedContent {
    success: true;
    versionId: number;
    versionNumber: number;
    base: string;
    /**
     * Set when a Drive-linked save reached Google but the copy here has not
     * been pulled yet: the version numbers are the previous ones, and the
     * Drive sync brings the new version in.
     */
    syncPending?: boolean;
}

/** A failed call, with the server's sentence when it sent one. */
export class FileEditingError extends Error {
    constructor(
        readonly status: number,
        /** The server's code — `changed_since_opened`, `not_editable`… */
        readonly code: string | null,
        message: string
    ) {
        super(message);
        this.name = "FileEditingError";
    }
}

async function failure(res: Response, fallback: string): Promise<FileEditingError> {
    const body = (await res.json().catch(() => ({}))) as { error?: unknown; message?: unknown };
    const code = typeof body.error === "string" ? body.error : null;
    const message = typeof body.message === "string" && body.message ? body.message : fallback;
    return new FileEditingError(res.status, code, message);
}

export async function fetchEditable(
    documentId: number,
    fallback: string,
    signal?: AbortSignal
): Promise<EditableContent> {
    const res = await fetch(`/api/documents/${documentId}/editable`, { signal });
    if (!res.ok) throw await failure(res, fallback);
    return (await res.json()) as EditableContent;
}

export async function saveEditable(
    documentId: number,
    body: { base: string; html: string } | { base: string; text: string },
    fallback: string
): Promise<SavedContent> {
    const res = await fetch(`/api/documents/${documentId}/editable`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw await failure(res, fallback);
    return (await res.json()) as SavedContent;
}

/** POST /api/files — a new Markdown file in `folder`, ready for the editor. */
export async function createFile(
    params: { title?: string; folder: string },
    fallback: string
): Promise<{ documentId: number; title: string }> {
    const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
    });
    if (!res.ok) throw await failure(res, fallback);
    return (await res.json()) as { documentId: number; title: string };
}
