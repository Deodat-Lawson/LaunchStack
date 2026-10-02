import { ARTIFACT_TYPES, type ArtifactType } from "~/lib/artifact-content";

/**
 * How an imported Claude artifact's document row says what it is.
 *
 * An artifact is a source like any other — uploaded, indexed, citable — so
 * nothing about its URL tells it apart from a file someone uploaded. The
 * marker lives in `ocrMetadata`, beside the mindmap and agent-session markers,
 * and survives OCR completion the same way (it merges rather than replaces).
 *
 * The file behind it is stored as `text/plain` whatever the artifact is: an
 * artifact is untrusted code, and a stored HTML or SVG file opened directly
 * would run on this app's origin. The viewer renders it from the marker's
 * type, in a sandboxed frame with an opaque origin (ArtifactPreview).
 *
 * Pure shape work, so the same module serves the upload route, the
 * display-type sniff and the viewer.
 */

export const ARTIFACT_DOCUMENT_KIND = "claude-artifact";

export interface ArtifactDocumentMarker {
    kind: typeof ARTIFACT_DOCUMENT_KIND;
    artifactType: ArtifactType;
    /** Where it came from — a claude.ai share link, say — for "Open the original". */
    sourceUrl: string | null;
    importedAt: string;
}

export function artifactDocumentMarker(input: {
    artifactType: ArtifactType;
    sourceUrl?: string | null;
    importedAt?: Date;
}): ArtifactDocumentMarker {
    return {
        kind: ARTIFACT_DOCUMENT_KIND,
        artifactType: input.artifactType,
        sourceUrl: input.sourceUrl ?? null,
        importedAt: (input.importedAt ?? new Date()).toISOString(),
    };
}

/** The marker in a document row's `ocrMetadata`, or null when it is not an artifact. */
export function artifactMarkerOf(ocrMetadata: unknown): ArtifactDocumentMarker | null {
    if (!ocrMetadata || typeof ocrMetadata !== "object" || Array.isArray(ocrMetadata)) {
        return null;
    }
    const record = ocrMetadata as {
        kind?: unknown;
        artifactType?: unknown;
        sourceUrl?: unknown;
        importedAt?: unknown;
    };
    if (record.kind !== ARTIFACT_DOCUMENT_KIND) return null;
    const artifactType = (ARTIFACT_TYPES as readonly unknown[]).includes(record.artifactType)
        ? (record.artifactType as ArtifactType)
        : "code";
    return {
        kind: ARTIFACT_DOCUMENT_KIND,
        artifactType,
        sourceUrl: typeof record.sourceUrl === "string" ? record.sourceUrl : null,
        importedAt: typeof record.importedAt === "string" ? record.importedAt : "",
    };
}

/** True when the document row is an imported Claude artifact. */
export function isArtifactDocument(ocrMetadata: unknown): boolean {
    return artifactMarkerOf(ocrMetadata) !== null;
}
