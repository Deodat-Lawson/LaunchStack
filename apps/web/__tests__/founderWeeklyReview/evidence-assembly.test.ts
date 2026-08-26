import {
    dedupeEvidenceItems,
    FounderWeeklyReviewEvidenceConflictError,
    orderEvidenceItems,
    type FounderWeeklyReviewEvidenceItem,
} from "@launchstack/pipelines/founder-weekly-review";

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
    it("collapses canonically identical items with the same sourceId", () => {
        const result = dedupeEvidenceItems([
            makeItem("a", "2026-01-01T00:00:00.000Z"),
            makeItem("a", "2026-01-01T00:00:00.000Z"),
            makeItem("b"),
        ]);

        expect(result.map(i => i.sourceId)).toEqual(["a", "b"]);
        expect(result[0]?.sourceTimestamp).toBe("2026-01-01T00:00:00.000Z");
    });

    it("rejects sourceId conflicts even across source types", () => {
        expect(() =>
            dedupeEvidenceItems([
                makeItem("x", undefined, "document_change"),
                makeItem("x", undefined, "customer_feedback"),
            ])
        ).toThrow(FounderWeeklyReviewEvidenceConflictError);
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

        expect(result.map(i => i.sourceId)).toEqual(["a", "c", "b"]);
    });

    it("breaks ties on identity when timestamps are equal", () => {
        const ts = "2026-01-01T00:00:00.000Z";
        const result = orderEvidenceItems([makeItem("z", ts), makeItem("a", ts)]);

        expect(result.map(i => i.sourceId)).toEqual(["a", "z"]);
    });

    it("orders source-type ties with ordinal comparison, not locale collation", () => {
        const ts = "2026-01-01T00:00:00.000Z";
        const result = orderEvidenceItems([
            makeItem("same", ts, "github_activity"),
            makeItem("same", ts, "customer_feedback"),
        ]);
        expect(result.map(item => item.sourceType)).toEqual([
            "customer_feedback",
            "github_activity",
        ]);
    });

    it("sorts items without a timestamp first", () => {
        const result = orderEvidenceItems([
            makeItem("withTs", "2026-01-01T00:00:00.000Z"),
            makeItem("noTs"),
        ]);

        expect(result.map(i => i.sourceId)).toEqual(["noTs", "withTs"]);
    });

    it("does not mutate the input array", () => {
        const input = [
            makeItem("b", "2026-02-01T00:00:00.000Z"),
            makeItem("a", "2026-01-01T00:00:00.000Z"),
        ];
        const originalOrder = input.map(i => i.sourceId);

        orderEvidenceItems(input);

        expect(input.map(i => i.sourceId)).toEqual(originalOrder);
    });
});
