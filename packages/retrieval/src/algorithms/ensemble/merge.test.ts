import { describe, expect, it } from "vitest";

import { mergeSiblingChunks } from "./ensemble";
import type { SearchResult } from "../../search-types";

/**
 * Sibling merging is what stops one section of one document filling every
 * result slot. Both legs can return the same section — the vector leg as
 * several of its children, the lexical leg as the parent — and rank fusion
 * happily ranks those near-identical entries above genuinely different
 * sections.
 */

function hit(parentChunkId: number | undefined, content: string): SearchResult {
    return {
        pageContent: content,
        metadata: {
            parentChunkId,
            documentId: 1,
            page: 1,
            source: "vector_ann",
            searchScope: "company",
        } as unknown as SearchResult["metadata"],
    };
}

describe("mergeSiblingChunks", () => {
    it("keeps one entry per section, at its best position", () => {
        const merged = mergeSiblingChunks([
            hit(10, "Infrastructure section"),
            hit(10, "Infrastructure section"),
            hit(20, "Billing section"),
            hit(10, "Infrastructure section"),
        ]);
        expect(merged).toHaveLength(2);
        expect(merged[0]!.pageContent).toBe("Infrastructure section");
        expect(merged[1]!.pageContent).toBe("Billing section");
    });

    it("records how many of a section's chunks matched", () => {
        const merged = mergeSiblingChunks([hit(10, "a"), hit(10, "a"), hit(10, "a"), hit(20, "b")]);
        expect((merged[0]!.metadata as { mergedSiblings?: number }).mergedSiblings).toBe(3);
        expect((merged[1]!.metadata as { mergedSiblings?: number }).mergedSiblings).toBe(1);
    });

    it("leaves order otherwise untouched", () => {
        const merged = mergeSiblingChunks([hit(1, "a"), hit(2, "b"), hit(3, "c")]);
        expect(merged.map(r => r.pageContent)).toEqual(["a", "b", "c"]);
    });

    it("never merges on a guess", () => {
        // No parent id — a notes hit, a graph hit, a legacy row — is left alone
        // even when the text repeats.
        const merged = mergeSiblingChunks([
            hit(undefined, "same words"),
            hit(undefined, "same words"),
        ]);
        expect(merged).toHaveLength(2);
    });

    it("is a no-op on an empty result set", () => {
        expect(mergeSiblingChunks([])).toEqual([]);
    });
});
