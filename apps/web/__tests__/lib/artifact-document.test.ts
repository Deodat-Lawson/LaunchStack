import {
    ARTIFACT_DOCUMENT_KIND,
    artifactDocumentMarker,
    artifactMarkerOf,
    isArtifactDocument,
} from "~/lib/artifact-document";
import { getDocumentDisplayType } from "~/app/employer/documents/types/document";

/**
 * An imported Claude artifact is an ordinary source with a marker in its
 * `ocrMetadata`. The marker is what makes the viewer render it in a sandbox
 * instead of as its (plain-text) file — so reading it has to be exact.
 */
describe("artifact document marker", () => {
    it("round-trips what the upload route writes", () => {
        const marker = artifactDocumentMarker({
            artifactType: "svg",
            sourceUrl: "https://claude.ai/share/x",
            importedAt: new Date("2026-09-29T00:00:00Z"),
        });
        expect(marker).toEqual({
            kind: ARTIFACT_DOCUMENT_KIND,
            artifactType: "svg",
            sourceUrl: "https://claude.ai/share/x",
            importedAt: "2026-09-29T00:00:00.000Z",
        });
        expect(artifactMarkerOf({ ...marker, confidence: 0.9 })).toEqual(marker);
    });

    it("ignores rows that are not artifacts, and repairs an unknown type", () => {
        expect(isArtifactDocument(null)).toBe(false);
        expect(isArtifactDocument({ kind: "mindmap", mindmapId: 3 })).toBe(false);
        expect(isArtifactDocument([ARTIFACT_DOCUMENT_KIND])).toBe(false);
        expect(
            artifactMarkerOf({ kind: ARTIFACT_DOCUMENT_KIND, artifactType: "exe" })
        ).toMatchObject({
            artifactType: "code",
            sourceUrl: null,
        });
    });

    it("opens as an artifact, whatever its file looks like", () => {
        const stored = { url: "/api/files/9", title: "Dashboard", mimeType: "text/plain" };
        expect(getDocumentDisplayType(stored)).toBe("text");
        expect(
            getDocumentDisplayType({
                ...stored,
                ocrMetadata: { ...artifactDocumentMarker({ artifactType: "html" }) },
            })
        ).toBe("artifact");
    });
});
