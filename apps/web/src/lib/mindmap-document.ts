/**
 * How a published mindmap's document row says what it is.
 *
 * The citable copy of a map is a Markdown outline pushed through ordinary
 * ingestion, so nothing about the row's URL or MIME type distinguishes it
 * from an uploaded `.md`. The marker lives in `ocrMetadata` — the same place
 * the agent-sessions connector keeps its provenance — and it must survive
 * OCR completion, which merges rather than replaces the column.
 *
 * Pure string and shape work, so the same module serves the publish route,
 * the display-type sniff and the viewer.
 */

export const MINDMAP_DOCUMENT_KIND = "mindmap";

export interface MindmapDocumentMarker {
    kind: typeof MINDMAP_DOCUMENT_KIND;
    mindmapId: number;
    /** The map revision the outline was rendered from. */
    revision: number;
    publishedAt: string;
}

export function mindmapDocumentMarker(input: {
    mindmapId: number;
    revision: number;
    publishedAt?: Date;
}): MindmapDocumentMarker {
    return {
        kind: MINDMAP_DOCUMENT_KIND,
        mindmapId: input.mindmapId,
        revision: input.revision,
        publishedAt: (input.publishedAt ?? new Date()).toISOString(),
    };
}

/** True when the document row is the citable copy of a mindmap. */
export function isMindmapDocument(ocrMetadata: unknown): boolean {
    return mindmapIdOf(ocrMetadata) !== null;
}

/** The map's id from a document row's `ocrMetadata`, or null. */
export function mindmapIdOf(ocrMetadata: unknown): number | null {
    if (!ocrMetadata || typeof ocrMetadata !== "object" || Array.isArray(ocrMetadata)) {
        return null;
    }
    const record = ocrMetadata as { kind?: unknown; mindmapId?: unknown };
    if (record.kind !== MINDMAP_DOCUMENT_KIND) return null;
    const id =
        typeof record.mindmapId === "number"
            ? record.mindmapId
            : typeof record.mindmapId === "string"
              ? Number.parseInt(record.mindmapId, 10)
              : Number.NaN;
    return Number.isInteger(id) && id > 0 ? id : null;
}
