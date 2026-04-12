import { GraphRetrieverResultSchema } from "./contracts/graphrag-schemas";

describe("contract: ensemble-search", () => {
    it("accepts a valid result with section IDs", () => {
        const result = GraphRetrieverResultSchema.safeParse({
            sectionIds: [1, 2, 3, 42],
            entityMatchCount: 5,
            traversalHops: 2,
            durationMs: 87.3,
        });
        expect(result.success).toBe(true);
    });

    it("accepts a result with empty sectionIds", () => {
        const result = GraphRetrieverResultSchema.safeParse({
            sectionIds: [],
            entityMatchCount: 0,
            traversalHops: 0,
            durationMs: 12.0,
        });
        expect(result.success).toBe(true);
    });

    it("accepts zero entity match count", () => {
        const result = GraphRetrieverResultSchema.safeParse({
            sectionIds: [10],
            entityMatchCount: 0,
            traversalHops: 1,
            durationMs: 5.0,
        });
        expect(result.success).toBe(true);
    });

    it("accepts zero traversal hops", () => {
        const result = GraphRetrieverResultSchema.safeParse({
            sectionIds: [10],
            entityMatchCount: 3,
            traversalHops: 0,
            durationMs: 5.0,
        });
        expect(result.success).toBe(true);
    });

    it("rejects invalid section ID (zero is not positive)", () => {
        const result = GraphRetrieverResultSchema.safeParse({
            sectionIds: [0],
            entityMatchCount: 1,
            traversalHops: 1,
            durationMs: 5.0,
        });
        expect(result.success).toBe(false);
    });

    it("rejects negative section ID", () => {
        const result = GraphRetrieverResultSchema.safeParse({
            sectionIds: [-1],
            entityMatchCount: 1,
            traversalHops: 1,
            durationMs: 5.0,
        });
        expect(result.success).toBe(false);
    });

    it("rejects missing sectionIds field", () => {
        const result = GraphRetrieverResultSchema.safeParse({
            entityMatchCount: 5,
            traversalHops: 2,
            durationMs: 87.3,
        });
        expect(result.success).toBe(false);
    });

    it("rejects missing entityMatchCount field", () => {
        const result = GraphRetrieverResultSchema.safeParse({
            sectionIds: [1, 2],
            traversalHops: 2,
            durationMs: 87.3,
        });
        expect(result.success).toBe(false);
    });

    it("rejects missing durationMs field", () => {
        const result = GraphRetrieverResultSchema.safeParse({
            sectionIds: [1, 2],
            entityMatchCount: 5,
            traversalHops: 2,
        });
        expect(result.success).toBe(false);
    });

    it("rejects negative durationMs", () => {
        const result = GraphRetrieverResultSchema.safeParse({
            sectionIds: [1],
            entityMatchCount: 1,
            traversalHops: 1,
            durationMs: -1,
        });
        expect(result.success).toBe(false);
    });
});
