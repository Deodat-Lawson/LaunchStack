import {
    dedupeEvidenceItems,
    orderEvidenceItems,
    type FounderWeeklyReviewEvidenceItem,
} from "@launchstack/features/founder-weekly-review";

function makeItem(
    sourceId: string,
    sourceTimestamp?: string,
    sourceType: FounderWeeklyReviewEvidenceItem["sourceType"] = "document_change"
): FounderWeeklyReviewEvidenceItem {
    return {
        sourceType,
        sourceId,
        title: `Title ${sourceId}`,
        sourceTimestamp,
        excerpt: `Excerpt ${sourceId}`,
        metadata: {},
    };
}

describe("dedupeEvidenceItems", () => {
    it("collapses items with the same sourceType+sourceId, keeping the first", () => {
        const result = dedupeEvidenceItems([
            makeItem("a", "2026-01-01T00:00:00.000Z"),
            makeItem("a", "2026-02-01T00:00:00.000Z"), // duplicate identity
            makeItem("b"),
        ]);

        expect(result.map((i) => i.sourceId)).toEqual(["a", "b"]);
        // the FIRST "a" survives, so its timestamp is the January one
        expect(result[0]?.sourceTimestamp).toBe("2026-01-01T00:00:00.000Z");
    });

    it("keeps items that share a sourceId but differ in sourceType", () => {
        const result = dedupeEvidenceItems([
            makeItem("x", undefined, "document_change"),
            makeItem("x", undefined, "customer_feedback"),
        ]);

        expect(result).toHaveLength(2);
    });

    it("returns an empty array unchanged", () => {
        expect(dedupeEvidenceItems([])).toEqual([]);
    });
});

describe("orderEvidenceItems", () => {
    it("sorts by sourceTimestamp ascending", () => {
        const result = orderEvidenceItems([
            makeItem("b", "2026-03-01T00:00:00.000Z"),
            makeItem("a", "2026-01-01T00:00:00.000Z"),
            makeItem("c", "2026-02-01T00:00:00.000Z"),
        ]);

        expect(result.map((i) => i.sourceId)).toEqual(["a", "c", "b"]);
    });

    it("breaks ties on identity when timestamps are equal", () => {
        const ts = "2026-01-01T00:00:00.000Z";
        const result = orderEvidenceItems([makeItem("z", ts), makeItem("a", ts)]);

        expect(result.map((i) => i.sourceId)).toEqual(["a", "z"]);
    });

    it("sorts items without a timestamp first", () => {
        const result = orderEvidenceItems([
            makeItem("withTs", "2026-01-01T00:00:00.000Z"),
            makeItem("noTs"),
        ]);

        expect(result.map((i) => i.sourceId)).toEqual(["noTs", "withTs"]);
    });

    it("does not mutate the input array", () => {
        const input = [
            makeItem("b", "2026-02-01T00:00:00.000Z"),
            makeItem("a", "2026-01-01T00:00:00.000Z"),
        ];
        const originalOrder = input.map((i) => i.sourceId);

        orderEvidenceItems(input);

        expect(input.map((i) => i.sourceId)).toEqual(originalOrder);
    });
});
