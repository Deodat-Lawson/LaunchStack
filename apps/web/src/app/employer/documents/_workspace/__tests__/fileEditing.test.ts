import { canEditFileHere } from "../fileEditing";
import type { WorkspaceSource } from "../types";

/**
 * Who sees Edit in the viewer: someone who may change the file (ADR-014),
 * on a saved document of a kind the editor writes back — Markdown, plain
 * text, Word (which a Drive-linked Google Doc is stored as). PDFs,
 * spreadsheets, maps, synced connector files and the like stay read-only.
 */
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function source(overrides: Partial<WorkspaceSource> = {}): WorkspaceSource {
    return {
        id: "d7",
        documentId: 7,
        title: "Plan",
        type: "doc",
        size: "",
        added: "",
        folder: "Strategy",
        tags: [],
        domain: "general",
        ...overrides,
    } as WorkspaceSource;
}

function doc(mimeType: string | undefined, extra: Record<string, unknown> = {}) {
    return { title: "Plan", url: "/api/files/1", mimeType, ...extra };
}

describe("canEditFileHere", () => {
    it("offers Edit on Markdown, plain text and Word to someone who can edit", () => {
        expect(canEditFileHere(source(), doc("text/markdown"))).toBe(true);
        expect(canEditFileHere(source(), doc("text/plain"))).toBe(true);
        expect(canEditFileHere(source(), doc(DOCX))).toBe(true);
    });

    it("hides it from someone the file is only shared with to view", () => {
        const viewOnly = source({
            access: { canEdit: false } as WorkspaceSource["access"],
        });
        expect(canEditFileHere(viewOnly, doc("text/markdown"))).toBe(false);
        expect(canEditFileHere(viewOnly, doc(DOCX))).toBe(false);
    });

    it("hides it on formats the editor cannot write back", () => {
        expect(canEditFileHere(source(), doc("application/pdf"))).toBe(false);
        expect(canEditFileHere(source(), doc("application/msword"))).toBe(false);
        expect(canEditFileHere(source(), doc("text/csv"))).toBe(false);
        expect(
            canEditFileHere(
                source(),
                doc("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            )
        ).toBe(false);
        expect(canEditFileHere(source(), doc("image/png"))).toBe(false);
    });

    it("hides it on a file a connector keeps syncing, which would undo the edit", () => {
        expect(
            canEditFileHere(source(), doc(DOCX, { ocrMetadata: { connector: "google-drive" } }))
        ).toBe(false);
    });

    it("waits for the document row, and never offers it on a map", () => {
        expect(canEditFileHere(source(), null)).toBe(false);
        expect(
            canEditFileHere(
                source({ id: "m3", type: "mindmap", mindmapId: 3, documentId: 9 }),
                doc("text/markdown")
            )
        ).toBe(false);
    });

    it("needs a saved document", () => {
        expect(
            canEditFileHere(source({ id: "s1", documentId: undefined }), doc("text/markdown"))
        ).toBe(false);
    });
});
