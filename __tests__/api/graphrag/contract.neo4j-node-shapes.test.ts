import {
    Neo4jEntityNodeSchema,
    Neo4jSectionNodeSchema,
    Neo4jDocumentNodeSchema,
    Neo4jTopicNodeSchema,
    Neo4jCommunityNodeSchema,
} from "./contracts/graphrag-schemas";

const make768Embedding = () => Array(768).fill(0.1);

describe("contract: neo4j-node-shapes", () => {
    describe("Neo4jEntityNodeSchema", () => {
        it("accepts a valid entity node with embedding", () => {
            const result = Neo4jEntityNodeSchema.safeParse({
                name: "apple inc",
                displayName: "Apple Inc",
                label: "ORG",
                confidence: 0.95,
                mentionCount: 12,
                companyId: "company-123",
                embedding: make768Embedding(),
            });
            expect(result.success).toBe(true);
        });

        it("accepts a valid entity node with null embedding", () => {
            const result = Neo4jEntityNodeSchema.safeParse({
                name: "apple inc",
                displayName: "Apple Inc",
                label: "ORG",
                confidence: 0.95,
                mentionCount: 12,
                companyId: "company-123",
                embedding: null,
            });
            expect(result.success).toBe(true);
        });

        it("rejects wrong embedding dimensions", () => {
            const result = Neo4jEntityNodeSchema.safeParse({
                name: "apple inc",
                displayName: "Apple Inc",
                label: "ORG",
                confidence: 0.95,
                mentionCount: 12,
                companyId: "company-123",
                embedding: Array(512).fill(0.1),
            });
            expect(result.success).toBe(false);
        });

        it("rejects missing required name", () => {
            const result = Neo4jEntityNodeSchema.safeParse({
                displayName: "Apple Inc",
                label: "ORG",
                confidence: 0.95,
                mentionCount: 12,
                companyId: "company-123",
                embedding: null,
            });
            expect(result.success).toBe(false);
        });

        it("rejects zero mentionCount", () => {
            const result = Neo4jEntityNodeSchema.safeParse({
                name: "apple inc",
                displayName: "Apple Inc",
                label: "ORG",
                confidence: 0.95,
                mentionCount: 0,
                companyId: "company-123",
                embedding: null,
            });
            expect(result.success).toBe(false);
        });
    });

    describe("Neo4jSectionNodeSchema", () => {
        it("accepts a valid section node", () => {
            const result = Neo4jSectionNodeSchema.safeParse({ id: 42, documentId: 7 });
            expect(result.success).toBe(true);
        });

        it("rejects missing documentId", () => {
            const result = Neo4jSectionNodeSchema.safeParse({ id: 42 });
            expect(result.success).toBe(false);
        });

        it("rejects non-positive id", () => {
            const result = Neo4jSectionNodeSchema.safeParse({ id: 0, documentId: 7 });
            expect(result.success).toBe(false);
        });
    });

    describe("Neo4jDocumentNodeSchema", () => {
        it("accepts a valid document node", () => {
            const result = Neo4jDocumentNodeSchema.safeParse({
                id: 1,
                name: "Annual Report 2024.pdf",
                companyId: "company-123",
                uploadedAt: "2024-01-15T10:30:00Z",
            });
            expect(result.success).toBe(true);
        });

        it("rejects missing name", () => {
            const result = Neo4jDocumentNodeSchema.safeParse({
                id: 1,
                companyId: "company-123",
                uploadedAt: "2024-01-15T10:30:00Z",
            });
            expect(result.success).toBe(false);
        });

        it("rejects missing companyId", () => {
            const result = Neo4jDocumentNodeSchema.safeParse({
                id: 1,
                name: "Annual Report 2024.pdf",
                uploadedAt: "2024-01-15T10:30:00Z",
            });
            expect(result.success).toBe(false);
        });
    });

    describe("Neo4jTopicNodeSchema", () => {
        it("accepts a valid topic node with 768-dim embedding", () => {
            const result = Neo4jTopicNodeSchema.safeParse({
                name: "Machine Learning",
                companyId: "company-123",
                embedding: make768Embedding(),
            });
            expect(result.success).toBe(true);
        });

        it("rejects wrong embedding dimensions", () => {
            const result = Neo4jTopicNodeSchema.safeParse({
                name: "Machine Learning",
                companyId: "company-123",
                embedding: Array(256).fill(0.1),
            });
            expect(result.success).toBe(false);
        });

        it("rejects missing embedding", () => {
            const result = Neo4jTopicNodeSchema.safeParse({
                name: "Machine Learning",
                companyId: "company-123",
            });
            expect(result.success).toBe(false);
        });
    });

    describe("Neo4jCommunityNodeSchema", () => {
        it("accepts a valid community node", () => {
            const result = Neo4jCommunityNodeSchema.safeParse({
                id: 0,
                summary: "A cluster of tech companies and their executives.",
                companyId: "company-123",
                embedding: make768Embedding(),
            });
            expect(result.success).toBe(true);
        });

        it("accepts id of 0 (nonnegative)", () => {
            const result = Neo4jCommunityNodeSchema.safeParse({
                id: 0,
                summary: "Summary text.",
                companyId: "company-123",
                embedding: make768Embedding(),
            });
            expect(result.success).toBe(true);
        });

        it("rejects negative id", () => {
            const result = Neo4jCommunityNodeSchema.safeParse({
                id: -1,
                summary: "Summary text.",
                companyId: "company-123",
                embedding: make768Embedding(),
            });
            expect(result.success).toBe(false);
        });

        it("rejects missing summary", () => {
            const result = Neo4jCommunityNodeSchema.safeParse({
                id: 1,
                companyId: "company-123",
                embedding: make768Embedding(),
            });
            expect(result.success).toBe(false);
        });
    });
});
