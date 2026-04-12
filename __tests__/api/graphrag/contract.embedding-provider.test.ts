import {
    EmbeddingResultSchema,
    EmbeddingBatchResultSchema,
} from "./contracts/graphrag-schemas";

describe("contract: embedding-provider", () => {
    describe("EmbeddingResultSchema", () => {
        it("accepts a valid BERT single result", () => {
            const result = EmbeddingResultSchema.safeParse({
                embedding: Array(768).fill(0.1),
                dimensions: 768,
                providerName: "bert",
            });
            expect(result.success).toBe(true);
        });

        it("accepts a valid OpenAI-compatible single result", () => {
            const result = EmbeddingResultSchema.safeParse({
                embedding: Array(1536).fill(0.05),
                dimensions: 1536,
                providerName: "openai-compatible",
            });
            expect(result.success).toBe(true);
        });

        it("rejects empty embedding array", () => {
            const result = EmbeddingResultSchema.safeParse({
                embedding: [],
                dimensions: 768,
                providerName: "bert",
            });
            expect(result.success).toBe(false);
        });

        it("rejects missing dimensions", () => {
            const result = EmbeddingResultSchema.safeParse({
                embedding: Array(768).fill(0.1),
                providerName: "bert",
            });
            expect(result.success).toBe(false);
        });

        it("rejects missing providerName", () => {
            const result = EmbeddingResultSchema.safeParse({
                embedding: Array(768).fill(0.1),
                dimensions: 768,
            });
            expect(result.success).toBe(false);
        });

        it("rejects zero dimensions", () => {
            const result = EmbeddingResultSchema.safeParse({
                embedding: Array(768).fill(0.1),
                dimensions: 0,
                providerName: "bert",
            });
            expect(result.success).toBe(false);
        });
    });

    describe("EmbeddingBatchResultSchema", () => {
        it("accepts a valid BERT batch result", () => {
            const result = EmbeddingBatchResultSchema.safeParse({
                embeddings: [Array(768).fill(0.1), Array(768).fill(0.2)],
                dimensions: 768,
                providerName: "bert",
            });
            expect(result.success).toBe(true);
        });

        it("accepts a single-item batch", () => {
            const result = EmbeddingBatchResultSchema.safeParse({
                embeddings: [Array(768).fill(0.1)],
                dimensions: 768,
                providerName: "bert",
            });
            expect(result.success).toBe(true);
        });

        it("accepts an empty batch", () => {
            const result = EmbeddingBatchResultSchema.safeParse({
                embeddings: [],
                dimensions: 768,
                providerName: "bert",
            });
            expect(result.success).toBe(true);
        });

        it("rejects batch with empty inner embedding", () => {
            const result = EmbeddingBatchResultSchema.safeParse({
                embeddings: [[]],
                dimensions: 768,
                providerName: "bert",
            });
            expect(result.success).toBe(false);
        });

        it("rejects missing dimensions", () => {
            const result = EmbeddingBatchResultSchema.safeParse({
                embeddings: [Array(768).fill(0.1)],
                providerName: "bert",
            });
            expect(result.success).toBe(false);
        });

        it("rejects missing providerName", () => {
            const result = EmbeddingBatchResultSchema.safeParse({
                embeddings: [Array(768).fill(0.1)],
                dimensions: 768,
            });
            expect(result.success).toBe(false);
        });
    });
});
