/**
 * Source ids in answers: the model cites "[d12]", the server reads the ids
 * for the source list and takes them out, and the client hides them — a
 * half-written one included — while the answer streams.
 */
import {
    citedDocumentIds,
    labelDocumentId,
    sourceLabel,
    stripSourceLabels,
    stripStreamingSourceLabels,
} from "~/lib/source-labels";

describe("source labels", () => {
    it("names a source by its document id, and reads the forms a model writes back", () => {
        expect(sourceLabel(12)).toBe("d12");
        for (const form of ["d12", "D12", "[d12]", " d12 ", "12", 12]) {
            expect(labelDocumentId(form)).toBe(12);
        }
        for (const form of ["F12", "d0", "d", "12a", "", null, {}]) {
            expect(labelDocumentId(form)).toBeNull();
        }
    });

    it("reads every cited id once, in the order the answer first cites it", () => {
        const answer =
            "Rafael Chen [d40], Leo Yang [d12, d7] and Albert Li (d9). Rafael again [d40]; Ayla ([d3]).";
        expect(citedDocumentIds(answer)).toEqual([40, 12, 7, 9, 3]);
    });

    it("does not take d15 for d150, or a plain word for an id", () => {
        expect(citedDocumentIds("See [d150]. The d15 model and (dx) are not citations.")).toEqual([
            150,
        ]);
    });

    it("reads a range as the sources shown inside it, written either way", () => {
        const shown = [3, 5, 7, 9, 12, 40];
        // Seen live: a 9B model wrote "[d196-d200]" and "MD [d164]–[d200]."
        expect(citedDocumentIds("Everyone [d3-d9].", shown)).toEqual([3, 5, 7, 9]);
        expect(citedDocumentIds("Everyone [d3]–[d9], and Rafael [d40].", shown)).toEqual([
            3, 5, 7, 9, 40,
        ]);
        expect(citedDocumentIds("Everyone [d9–d3]", shown)).toEqual([3, 5, 7, 9]);
        // Without knowing what was shown, only the ends.
        expect(citedDocumentIds("Everyone [d3-d9]")).toEqual([3, 9]);
        expect(stripSourceLabels("Baltimore, MD [d3]–[d9]. Everyone [d3-d9], done.")).toBe(
            "Baltimore, MD. Everyone, done."
        );
    });

    it("reads and removes loosely written citations, but leaves links and ordinary brackets", () => {
        // Seen live from a 9B model.
        const answer =
            "Lucia Moreau [v2] [d237, v1], Mira Okafor (Also found in: d1), Omar [d40]. See [the d12 notes](https://x.test).";
        expect(citedDocumentIds(answer)).toEqual([237, 1, 40]);
        expect(stripSourceLabels(answer)).toBe(
            "Lucia Moreau [v2], Mira Okafor, Omar. See [the d12 notes](https://x.test)."
        );
        expect(stripSourceLabels("Option (a) and [b] stay.")).toBe("Option (a) and [b] stay.");
    });

    it("takes the ids out of the text and nothing else", () => {
        expect(
            stripSourceLabels(
                "Rafael Chen [d40], Leo Yang [d12; d7] and Albert Li (d9).\n- Ayla Zhang ([d3])\n[a link](https://x.test) stays (and so do these words)."
            )
        ).toBe(
            "Rafael Chen, Leo Yang and Albert Li.\n- Ayla Zhang\n[a link](https://x.test) stays (and so do these words)."
        );
    });

    it("hides a citation still being written while the answer streams", () => {
        expect(stripStreamingSourceLabels("Rafael Chen [d4")).toBe("Rafael Chen");
        expect(stripStreamingSourceLabels("Rafael Chen [d40, d")).toBe("Rafael Chen");
        expect(stripStreamingSourceLabels("Everyone [d3-")).toBe("Everyone");
        expect(stripStreamingSourceLabels("Rafael Chen [")).toBe("Rafael Chen");
        expect(stripStreamingSourceLabels("Rafael Chen [d40] and")).toBe("Rafael Chen and");
        expect(stripStreamingSourceLabels("See [the plan")).toBe("See [the plan");
    });
});
