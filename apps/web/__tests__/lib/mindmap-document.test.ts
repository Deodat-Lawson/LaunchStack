import { getDocumentDisplayType } from "~/app/employer/documents/types/document";
import {
    isMindmapDocument,
    MINDMAP_DOCUMENT_KIND,
    mindmapDocumentMarker,
    mindmapIdOf,
} from "~/lib/mindmap-document";

/**
 * The published copy of a mindmap is a Markdown file on disk. The marker in
 * `ocrMetadata` is the only thing that says "render this as the map", so the
 * sniff must honour it — and must keep honouring it after OCR completion has
 * merged its own keys in beside it.
 */

describe("mindmapDocumentMarker", () => {
    it("records the map and the revision it was rendered from", () => {
        const marker = mindmapDocumentMarker({
            mindmapId: 7,
            revision: 4,
            publishedAt: new Date("2026-09-02T12:00:00Z"),
        });
        expect(marker).toEqual({
            kind: MINDMAP_DOCUMENT_KIND,
            mindmapId: 7,
            revision: 4,
            publishedAt: "2026-09-02T12:00:00.000Z",
        });
    });
});

describe("mindmapIdOf", () => {
    it("reads the id out of a marked row", () => {
        expect(mindmapIdOf({ kind: "mindmap", mindmapId: 7 })).toBe(7);
        expect(isMindmapDocument({ kind: "mindmap", mindmapId: 7 })).toBe(true);
    });

    it("survives OCR completion writing beside it", () => {
        expect(
            mindmapIdOf({ kind: "mindmap", mindmapId: 7, totalPages: 1, processedAt: "…" })
        ).toBe(7);
    });

    it("tolerates a stringified id and refuses everything else", () => {
        expect(mindmapIdOf({ kind: "mindmap", mindmapId: "12" })).toBe(12);
        expect(mindmapIdOf({ kind: "mindmap", mindmapId: 0 })).toBeNull();
        expect(mindmapIdOf({ kind: "mindmap" })).toBeNull();
        expect(mindmapIdOf({ connector: "agent-sessions" })).toBeNull();
        expect(mindmapIdOf(null)).toBeNull();
        expect(mindmapIdOf("mindmap")).toBeNull();
        expect(mindmapIdOf([{ kind: "mindmap", mindmapId: 1 }])).toBeNull();
    });
});

describe("getDocumentDisplayType", () => {
    it("renders a marked Markdown file as a mindmap", () => {
        expect(
            getDocumentDisplayType({
                url: "/api/files/1",
                title: "Launch plan",
                mimeType: "text/markdown",
                ocrMetadata: { kind: "mindmap", mindmapId: 7 },
            })
        ).toBe("mindmap");
    });

    it("leaves an unmarked Markdown file as Markdown", () => {
        expect(
            getDocumentDisplayType({
                url: "/api/files/1",
                title: "Launch plan.md",
                mimeType: "text/markdown",
                ocrMetadata: { totalPages: 1 },
            })
        ).toBe("markdown");
    });

    it("lets the agent-sessions marker keep precedence", () => {
        expect(
            getDocumentDisplayType({
                url: "/api/files/1",
                title: "session",
                mimeType: "text/markdown",
                ocrMetadata: { connector: "agent-sessions", kind: "mindmap", mindmapId: 7 },
            })
        ).toBe("conversation");
    });
});
