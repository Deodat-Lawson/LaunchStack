/**
 * Which documents LaunchStack's own editor can open — one rule for the
 * server (`/api/documents/[id]/editable`) and the viewer's Edit button, so
 * the button never offers what the route will refuse.
 *
 * Pure: no server imports, safe in a client bundle.
 */
import { isArtifactDocument } from "~/lib/artifact-document";
import { hasTranscriptTitle, transcriptMarkerOf } from "~/lib/media-document";
import { isMindmapDocument } from "~/lib/mindmap-document";
import { websiteMarkerOf } from "~/lib/website-document";

export type EditableKind = "markdown" | "text" | "docx";

export const DOCX_EDITABLE_MIME =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** The MIME a saved version of each kind carries when the document never recorded one. */
export const EDITABLE_KIND_MIME: Record<EditableKind, string> = {
    markdown: "text/markdown",
    text: "text/plain",
    docx: DOCX_EDITABLE_MIME,
};

/**
 * Connectors whose files may be edited here. A connector that keeps
 * syncing (Drive, Notion, Gmail) would overwrite an edit on its next pass,
 * and a conversation is not a document; a one-time import is just a file.
 */
const EDITABLE_CONNECTORS = new Set(["obsidian"]);

export interface EditableDocumentLike {
    title: string;
    mimeType?: string | null;
    fileType?: string | null;
    url?: string | null;
    ocrMetadata?: unknown;
}

function connectorOf(ocrMetadata: unknown): unknown {
    if (!ocrMetadata || typeof ocrMetadata !== "object" || Array.isArray(ocrMetadata)) {
        return undefined;
    }
    return (ocrMetadata as Record<string, unknown>).connector;
}

function kindOfMime(mime: string): EditableKind | null | undefined {
    if (!mime) return undefined;
    if (mime === DOCX_EDITABLE_MIME || mime === "docx") return "docx";
    if (mime === "text/markdown" || mime === "text/x-markdown") return "markdown";
    if (mime === "text/plain") return "text";
    // A known type that is not one of ours (PDF, HTML, CSV, a .doc…).
    return null;
}

function kindOfName(name: string): EditableKind | null {
    const lower = name.toLowerCase().split(/[?#]/)[0] ?? "";
    if (lower.endsWith(".docx")) return "docx";
    if (/\.(md|markdown|mdown|mkd)$/.test(lower)) return "markdown";
    if (lower.endsWith(".txt")) return "text";
    return null;
}

/**
 * The editor kind for a document, or null when it cannot be edited here:
 * not text or Word, a sync-owned or conversation import, or a document that
 * is stored as text but read as something else (a mindmap, an artifact, a
 * saved web page, a transcript).
 */
export function editableKindOf(doc: EditableDocumentLike): EditableKind | null {
    const connector = connectorOf(doc.ocrMetadata);
    if (
        connector !== undefined &&
        connector !== null &&
        !(typeof connector === "string" && EDITABLE_CONNECTORS.has(connector))
    ) {
        return null;
    }
    if (isMindmapDocument(doc.ocrMetadata)) return null;
    if (isArtifactDocument(doc.ocrMetadata)) return null;
    if (websiteMarkerOf(doc.ocrMetadata)) return null;
    if (transcriptMarkerOf(doc.ocrMetadata) || hasTranscriptTitle(doc.title)) return null;

    for (const mime of [doc.fileType, doc.mimeType]) {
        const kind = kindOfMime((mime ?? "").toLowerCase().trim());
        if (kind !== undefined) return kind;
    }
    return kindOfName(doc.title) ?? (doc.url ? kindOfName(doc.url) : null);
}
