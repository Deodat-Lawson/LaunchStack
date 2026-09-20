/**
 * The order notes appear in the column.
 *
 * Docs lists comments in the order a reader meets them, which only works if
 * a note actually knows where it sits. Ours mostly do not: indexing stores
 * page 1 for every chunk, so an agent-captured anchor says "page 1, no
 * quads" and means nothing. These tests pin the rule that a position counts
 * only when there are quads behind it — the alternative is an ordering that
 * looks meaningful and is not.
 */

import { documentPositionOfAnchor, orderNotesForReading } from "../_shared/anchor";

type Note = { id: number; anchor: unknown; createdAt: string };

function positioned(id: number, page: number, top: number, createdAt = "2026-01-01"): Note {
    return {
        id,
        anchor: {
            type: "pdf",
            primary: { kind: "pdf", page, quads: [[0.1, top, 0.9, top + 0.02]] },
            quote: { exact: "x" },
        },
        createdAt,
    };
}

/** What every agent-captured note looks like today. */
function unpositioned(id: number, createdAt: string): Note {
    return {
        id,
        anchor: {
            type: "pdf",
            primary: { kind: "pdf", page: 1, quads: [] },
            quote: { exact: "x" },
        },
        createdAt,
    };
}

describe("documentPositionOfAnchor", () => {
    it("reads a position from a real selection", () => {
        expect(documentPositionOfAnchor(positioned(1, 3, 0.42).anchor as never)).toEqual({
            page: 3,
            top: 0.42,
        });
    });

    it("refuses a page with no quads behind it", () => {
        // This is the whole point: page 1 is what indexing writes for
        // everything, so page-without-quads is not a position.
        expect(documentPositionOfAnchor(unpositioned(1, "2026-01-01").anchor as never)).toBeNull();
    });

    it("has no position for a note with no anchor at all", () => {
        expect(documentPositionOfAnchor(null)).toBeNull();
    });
});

describe("orderNotesForReading", () => {
    it("puts positioned notes in document order, page before offset", () => {
        const out = orderNotesForReading([
            positioned(1, 2, 0.5),
            positioned(2, 1, 0.9),
            positioned(3, 1, 0.1),
        ]);
        expect(out.map(n => n.id)).toEqual([3, 2, 1]);
    });

    it("keeps unpositioned notes newest-first", () => {
        const out = orderNotesForReading([
            unpositioned(1, "2026-01-01T00:00:00Z"),
            unpositioned(2, "2026-03-01T00:00:00Z"),
            unpositioned(3, "2026-02-01T00:00:00Z"),
        ]);
        expect(out.map(n => n.id)).toEqual([2, 3, 1]);
    });

    it("reads placed notes first, then the ones with nowhere to sit", () => {
        const out = orderNotesForReading([
            unpositioned(1, "2026-03-01T00:00:00Z"),
            positioned(2, 5, 0.2),
            unpositioned(3, "2026-04-01T00:00:00Z"),
            positioned(4, 1, 0.8),
        ]);
        expect(out.map(n => n.id)).toEqual([4, 2, 3, 1]);
    });

    /**
     * Today every note is unpositioned, so the column must look exactly as it
     * did — this ordering is meant to become right when anchors do, not to
     * rearrange anything now.
     */
    it("is a no-op while nothing carries a real position", () => {
        const notes = [
            unpositioned(1, "2026-03-01T00:00:00Z"),
            unpositioned(2, "2026-02-01T00:00:00Z"),
            unpositioned(3, "2026-01-01T00:00:00Z"),
        ];
        expect(orderNotesForReading(notes).map(n => n.id)).toEqual([1, 2, 3]);
    });

    it("does not mutate the list it was given", () => {
        const notes = [positioned(1, 2, 0.5), positioned(2, 1, 0.5)];
        orderNotesForReading(notes);
        expect(notes.map(n => n.id)).toEqual([1, 2]);
    });

    it("survives a note with no createdAt", () => {
        const out = orderNotesForReading<{ id: number; anchor: unknown; createdAt: string | null }>(
            [
                { id: 1, anchor: null, createdAt: null },
                { id: 2, anchor: null, createdAt: "2026-01-01T00:00:00Z" },
            ]
        );
        expect(out.map(n => n.id)).toEqual([2, 1]);
    });
});
