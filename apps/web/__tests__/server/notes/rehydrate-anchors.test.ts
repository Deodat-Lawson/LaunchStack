import { rebuildAnchor } from "~/server/notes/rehydrate-anchors";
import type { NoteAnchor } from "~/server/db/schema";

jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("~/server/notes/embed-note", () => ({ requestNoteEmbedding: jest.fn() }));

/**
 * What a note's anchor becomes on a new version of its document. The page
 * follows the matched chunk and the quads are dropped (the viewer finds the
 * quote again); everything else on the anchor stays.
 */
describe("rebuildAnchor", () => {
    const chunk = { id: 9, pageNumber: 4, content: "net revenue fell" };
    const highlight: NoteAnchor = {
        type: "pdf",
        primary: {
            kind: "pdf",
            page: 1,
            quads: [[0.1, 0.2, 0.5, 0.24]],
            color: "pink",
        },
        quote: { exact: "net revenue fell" },
    };

    it("keeps a highlight's colour when the passage is found again", () => {
        expect(rebuildAnchor(highlight, { kind: "resolved", chunk, index: 0 })).toEqual({
            type: "pdf",
            primary: { kind: "pdf", page: 4, quads: [], color: "pink" },
            quote: { exact: "net revenue fell" },
        });
        expect(rebuildAnchor(highlight, { kind: "drifted", chunk, index: 3 }).primary).toEqual({
            kind: "pdf",
            page: 4,
            quads: [],
            color: "pink",
        });
    });

    it("leaves an ordinary note without a colour", () => {
        const note: NoteAnchor = { ...highlight, primary: { kind: "pdf", page: 1, quads: [] } };
        expect(rebuildAnchor(note, { kind: "resolved", chunk, index: 0 }).primary).toEqual({
            kind: "pdf",
            page: 4,
            quads: [],
        });
    });

    it("drops the primary of an orphaned note, keeping its quote", () => {
        expect(rebuildAnchor(highlight, { kind: "orphaned" })).toEqual({
            type: "pdf",
            quote: { exact: "net revenue fell" },
        });
    });
});
