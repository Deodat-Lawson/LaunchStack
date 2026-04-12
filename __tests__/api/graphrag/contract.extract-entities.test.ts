import {
    ExtractEntitiesResponseSchema,
    ExtractEntitiesEnhancedResponseSchema,
    EntityBaseSchema,
} from "./contracts/graphrag-schemas";

const make768Embedding = () => Array(768).fill(0.1);

describe("contract: extract-entities", () => {
    describe("EntityBaseSchema", () => {
        it("accepts a valid entity", () => {
            const result = EntityBaseSchema.safeParse({ text: "Apple", label: "ORG", score: 0.95 });
            expect(result.success).toBe(true);
        });

        it("rejects score above 1", () => {
            const result = EntityBaseSchema.safeParse({ text: "Apple", label: "ORG", score: 1.1 });
            expect(result.success).toBe(false);
        });

        it("rejects score below 0", () => {
            const result = EntityBaseSchema.safeParse({ text: "Apple", label: "ORG", score: -0.1 });
            expect(result.success).toBe(false);
        });

        it("rejects empty text", () => {
            const result = EntityBaseSchema.safeParse({ text: "", label: "ORG", score: 0.5 });
            expect(result.success).toBe(false);
        });
    });

    describe("ExtractEntitiesResponseSchema (base, without embeddings)", () => {
        it("accepts a valid base response", () => {
            const result = ExtractEntitiesResponseSchema.safeParse({
                results: [{ text: "Apple is a company.", entities: [{ text: "Apple", label: "ORG", score: 0.95 }] }],
                total_entities: 1,
            });
            expect(result.success).toBe(true);
        });

        it("accepts an empty response", () => {
            const result = ExtractEntitiesResponseSchema.safeParse({
                results: [],
                total_entities: 0,
            });
            expect(result.success).toBe(true);
        });

        it("accepts a response with empty entities array", () => {
            const result = ExtractEntitiesResponseSchema.safeParse({
                results: [{ text: "No entities here.", entities: [] }],
                total_entities: 0,
            });
            expect(result.success).toBe(true);
        });

        it("rejects missing total_entities", () => {
            const result = ExtractEntitiesResponseSchema.safeParse({
                results: [],
            });
            expect(result.success).toBe(false);
        });

        it("rejects negative total_entities", () => {
            const result = ExtractEntitiesResponseSchema.safeParse({
                results: [],
                total_entities: -1,
            });
            expect(result.success).toBe(false);
        });
    });

    describe("ExtractEntitiesEnhancedResponseSchema (with 768-dim embeddings)", () => {
        it("accepts a valid enhanced response with 768-dim embeddings", () => {
            const result = ExtractEntitiesEnhancedResponseSchema.safeParse({
                results: [
                    {
                        text: "Apple is a company.",
                        entities: [{ text: "Apple", label: "ORG", score: 0.95, embedding: make768Embedding() }],
                    },
                ],
                total_entities: 1,
            });
            expect(result.success).toBe(true);
        });

        it("accepts an empty enhanced response", () => {
            const result = ExtractEntitiesEnhancedResponseSchema.safeParse({
                results: [],
                total_entities: 0,
            });
            expect(result.success).toBe(true);
        });

        it("rejects wrong embedding dimensions (512 instead of 768)", () => {
            const result = ExtractEntitiesEnhancedResponseSchema.safeParse({
                results: [
                    {
                        text: "Apple is a company.",
                        entities: [{ text: "Apple", label: "ORG", score: 0.95, embedding: Array(512).fill(0.1) }],
                    },
                ],
                total_entities: 1,
            });
            expect(result.success).toBe(false);
        });

        it("rejects missing embedding in enhanced response", () => {
            const result = ExtractEntitiesEnhancedResponseSchema.safeParse({
                results: [
                    {
                        text: "Apple is a company.",
                        entities: [{ text: "Apple", label: "ORG", score: 0.95 }],
                    },
                ],
                total_entities: 1,
            });
            expect(result.success).toBe(false);
        });

        it("rejects score outside 0-1 in enhanced response", () => {
            const result = ExtractEntitiesEnhancedResponseSchema.safeParse({
                results: [
                    {
                        text: "Apple is a company.",
                        entities: [{ text: "Apple", label: "ORG", score: 2.0, embedding: make768Embedding() }],
                    },
                ],
                total_entities: 1,
            });
            expect(result.success).toBe(false);
        });
    });
});
